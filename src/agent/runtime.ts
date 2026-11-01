import { guard, repairs, route, savings, type Compute, type Decision, type GuardResult, type Repair, type RouteResult, type ToolCall } from '../app/gb';
import { pixie } from '../pixie/director';
import { session, uid, useSession, type AssistantItem, type NoticeItem, type RouteItem, type ToolItem, type UserItem } from '../state/session';
import { useSettings } from '../state/settings';
import { getKey } from '../state/keys';
import { useWorkspace, workspace } from '../workspace/store';
import { diffLines, diffStats } from '../workspace/diff';
import { ensureGlassbox, glassboxReady } from './glassbox';
import { appendLedger, sha256Hex } from './ledger';
import { ACTION_SCHEMA, correction, parseAction, partialField, protocolInstructions } from './protocol';
import { createOpenAiProvider } from './providers/openai';
import { PRESET_BY_ID } from './providers/presets';
import { createWebLlmProvider, isLoaded } from './providers/webllm';
import { createDemoProvider } from './providers/demo';
import { runInSandbox } from './sandbox/sandbox';
import { TOOL_SPECS, coerceArgs, describeCall, execFetch, execList, execRead, execSearch, nativeToolSchemas, resolveWorkspacePath, validateCall, type ToolOutput } from './tools';
import { ProviderError, type ChatMessage, type ChatResult, type LlmProvider } from './types';
import { researchTurn } from './research';

const MAX_STEPS = 14;

export interface TurnContext {
  provider: LlmProvider;
  signal: AbortSignal;
  route?: RouteResult;
  /** Set when an edit was accepted or tests passed, so Pixie can celebrate. */
  wins: { edits: number; testsPassed: boolean };
}

// ---------------------------------------------------------------------------
// Providers

let demoProvider: LlmProvider | null = null;
const remoteCache = new Map<string, LlmProvider>();

export function getDemoProvider(): LlmProvider {
  demoProvider ??= createDemoProvider();
  return demoProvider;
}

export function resolveProvider(): LlmProvider | { error: string } {
  const s = useSettings.getState();
  const m = s.model;
  if (m.kind === 'demo') return getDemoProvider();
  if (m.kind === 'webllm') {
    if (!isLoaded(m.modelId)) return { error: 'The in-browser model is not loaded yet. Open the model picker and load it.' };
    return createWebLlmProvider(m.modelId);
  }
  const preset = PRESET_BY_ID[m.providerId];
  if (!preset) return { error: 'Pick a model first.' };
  const cfg = s.providers[preset.id] ?? { baseUrl: preset.baseUrl, model: preset.models[0] ?? '', nativeTools: preset.nativeTools };
  const key = getKey(preset.id);
  if (!cfg.baseUrl) return { error: `Set a base URL for ${preset.name} in the model picker.` };
  if (!cfg.model) return { error: `Choose a model for ${preset.name} in the model picker.` };
  if (preset.needsKey && !key) return { error: `Add your ${preset.name} key in the model picker. It stays in this browser.` };
  const cacheKey = `${preset.id}|${cfg.baseUrl}|${cfg.model}|${cfg.nativeTools}|${key.length}`;
  let p = remoteCache.get(cacheKey);
  if (!p) {
    p = createOpenAiProvider({ preset, baseUrl: cfg.baseUrl, model: cfg.model, apiKey: key, nativeTools: cfg.nativeTools });
    remoteCache.set(cacheKey, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Approvals

type Choice = 'approve' | 'reject';
const waiters = new Map<string, (c: Choice) => void>();

function waitForApproval(id: string, signal: AbortSignal): Promise<Choice> {
  return new Promise((resolve) => {
    waiters.set(id, resolve);
    signal.addEventListener(
      'abort',
      () => {
        waiters.delete(id);
        resolve('reject');
      },
      { once: true },
    );
  });
}

/** Called by the approve / reject buttons. */
export function decide(itemId: string, choice: Choice) {
  const w = waiters.get(itemId);
  if (!w) return;
  waiters.delete(itemId);
  w(choice);
}

// ---------------------------------------------------------------------------
// Decision layer helpers

function account(compute: Compute, ms: number) {
  const s = savings(compute);
  session.addCompute({
    tmDecisions: 1,
    tmOps: s.tmOps,
    tmClauses: compute.clausesEvaluated,
    tmLiterals: compute.literalChecks,
    tmMs: ms,
    judgeOps: s.llmOps,
  });
}

function safeGuard(call: ToolCall): GuardResult | null {
  if (!useSettings.getState().guard || !glassboxReady()) return null;
  try {
    return guard(call);
  } catch {
    return null;
  }
}

function safeRoute(prompt: string): RouteResult | null {
  if (!glassboxReady()) return null;
  try {
    return route(prompt);
  } catch {
    return null;
  }
}

function topReason(g: GuardResult): string {
  const votes = g.evidence.filter((e) => e.cls === g.decision && e.polarity > 0).sort((a, b) => b.weight - a.weight);
  return votes[0]?.rule ?? (g.features.length ? `features: ${g.features.slice(0, 4).join(', ')}` : '');
}

function blockedMessage(call: ToolCall, g: GuardResult, fixes: Repair[]): string {
  const lines = [`BLOCKED by the glassbox guard (the winning class leads by ${Number.isInteger(g.margin) ? g.margin : g.margin.toFixed(2)} votes). ${describeCall(call)} did not run.`];
  const reason = topReason(g);
  if (reason) lines.push(`Main reason: ${reason}`);
  if (fixes.length) {
    lines.push('Safer alternatives you may use instead:');
    fixes.forEach((f, i) => lines.push(`${i + 1}. ${f.title}: ${f.call.tool} ${JSON.stringify(f.call.args)} (${f.why})`));
  } else lines.push('Do not retry this call. Explain to the user or choose a different approach.');
  return lines.join('\n');
}

/** A compact, hash-friendly record of a call for the ledger. */
async function ledgerCall(call: ToolCall) {
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(call.args)) {
    if ((k === 'content' || k === 'code') && v.length > 200) args[k] = `sha256:${await sha256Hex(v)} (${v.length} chars)`;
    else args[k] = v;
  }
  return { tool: call.tool, args };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…(${text.length - max} more characters)` : text;
}

// ---------------------------------------------------------------------------
// Pacing: the scripted demo moves at a human pace so every step can be seen.

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Stopped', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Stopped', 'AbortError'));
      },
      { once: true },
    );
  });
}

const DEMO_PACE: Record<string, number> = {
  guard: 750,
  list_files: 700,
  read_file: 1000,
  search: 1000,
  run_js: 1300,
  run_command: 900,
  write_file: 700,
  delete_file: 600,
  fetch_url: 900,
};

async function pace(ctx: TurnContext, what: string) {
  if (ctx.provider.scripted) await sleep(DEMO_PACE[what] ?? 600, ctx.signal);
}

// ---------------------------------------------------------------------------
// Guarded execution: every tool call is checked before it runs.

export async function guardedExecute(call: ToolCall, origin: 'agent' | 'you', ctx: TurnContext): Promise<string> {
  const ws = useWorkspace.getState();
  call = { ...call, workspaceRoot: call.workspaceRoot ?? ws.name };
  const settings = useSettings.getState();
  const item = session.add<ToolItem>({ kind: 'tool', id: uid('t'), call, status: 'checking', origin });
  const label = describeCall(call);
  session.setActivity(label);

  let decision: Decision | null = null;
  const g = safeGuard(call);
  if (g) {
    decision = g.decision;
    session.update<ToolItem>(item.id, { guard: g });
    account(g.compute, g.ms);
    pixie.show('guarding', `Checking “${label}” with the guard`, item.id);
    const entry = await appendLedger('guard', `${g.decision}: ${label}`, {
      call: await ledgerCall(call),
      decision: g.decision,
      scores: g.scores,
      margin: g.margin,
      clauses: g.evidence.map((e) => e.id),
      features: g.features,
      compute: g.compute,
      modelId: g.modelId,
    });
    session.timeline({ id: uid('e'), at: Date.now(), kind: 'guard', label, outcome: g.decision, itemId: item.id, ledgerSeq: entry.seq });
    await pace(ctx, 'guard');
  } else {
    session.update<ToolItem>(item.id, { guardOff: true });
  }

  if (g && decision === 'block') {
    const fixes = (() => {
      try {
        return repairs(call, g);
      } catch {
        return [];
      }
    })();
    session.update<ToolItem>(item.id, { status: 'blocked', repairs: fixes, decidedBy: 'guard' });
    pixie.show('blocked', `Blocked: ${label}`, item.id);
    return blockedMessage(call, g, fixes);
  }

  if (call.tool === 'run_command') {
    const cmd = call.args.command ?? '';
    session.update<ToolItem>(item.id, { status: 'proposal', decidedBy: g ? 'guard' : undefined, summary: 'Not run: commands cannot execute in a browser' });
    pixie.show('running', `Proposed: ${cmd}`, item.id);
    const entry = await appendLedger('tool', `Proposed (not run): ${cmd}`, { call: await ledgerCall(call), executed: false, decision });
    session.timeline({ id: uid('e'), at: Date.now(), kind: 'tool', label: `Proposed: ${cmd}`, outcome: 'proposal', itemId: item.id, ledgerSeq: entry.seq });
    await pace(ctx, 'run_command');
    const testHint = /\b(npm|pnpm|yarn)\s+(run\s+)?test\b|node\s+--test/.test(cmd) ? ' To run tests here, call run_js with the test file path.' : '';
    return `Not executed: commands cannot run in the browser.${decision ? ` The guard rated it "${decision}".` : ''} The user sees it as a proposal they can run themselves.${testHint}`;
  }

  // Prepare the diff for edits.
  const mutating = call.tool === 'write_file' || call.tool === 'delete_file';
  let targetPath = '';
  if (mutating) {
    const r = resolveWorkspacePath(call.args.path);
    if ('error' in r) {
      session.update<ToolItem>(item.id, { status: 'failed', output: r.error, summary: 'Outside the workspace' });
      return r.error;
    }
    targetPath = r.path;
    if (call.tool === 'write_file') {
      const before = ws.files[targetPath];
      const after = call.args.content ?? '';
      if (before === after) {
        session.update<ToolItem>(item.id, { status: 'done', summary: 'Already up to date', output: 'No changes: the file already has this content.' });
        return 'No changes: the file already has exactly this content.';
      }
      session.update<ToolItem>(item.id, { diff: { path: targetPath, before: before ?? '', after, isNew: before === undefined } });
    } else if (!(targetPath in ws.files)) {
      session.update<ToolItem>(item.id, { status: 'failed', summary: 'Not found', output: `No file named ${targetPath}.` });
      return `No file named ${targetPath}.`;
    }
  }

  const needsPerson = decision === 'ask' || (mutating && settings.askEdits) || (!g && (mutating || call.tool === 'run_js' || call.tool === 'fetch_url'));
  if (needsPerson) {
    const reason: ToolItem['awaitReason'] = decision === 'ask' ? 'guard' : call.tool === 'write_file' ? 'review' : 'confirm';
    session.update<ToolItem>(item.id, { status: 'awaiting', awaitReason: reason });
    if (call.tool === 'write_file') workspace.openTab(`review:${item.id}`);
    session.setActivity(reason === 'review' ? `Waiting for you to review ${targetPath}` : `Waiting for your OK: ${label}`);
    pixie.show('waiting', reason === 'review' ? `Review the edit to ${targetPath}` : `Needs your OK: ${label}`, item.id);
    const choice = await waitForApproval(item.id, ctx.signal);
    if (ctx.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const entry = await appendLedger('human', `${choice === 'approve' ? 'Approved' : 'Rejected'}: ${label}`, { itemId: item.id, call: await ledgerCall(call), choice, reason });
    session.timeline({ id: uid('e'), at: Date.now(), kind: 'human', label: `${choice === 'approve' ? 'You approved' : 'You rejected'}: ${label}`, outcome: choice === 'approve' ? 'approved' : 'rejected', itemId: item.id, ledgerSeq: entry.seq });
    if (call.tool === 'write_file') workspace.closeTab(`review:${item.id}`);
    if (choice !== 'approve') {
      session.update<ToolItem>(item.id, { status: 'denied', decidedBy: 'you' });
      pixie.show('thinking', 'Okay, not doing that.', item.id);
      return `The user rejected this ${mutating ? 'change' : 'action'}. Do not retry it unchanged.`;
    }
    session.update<ToolItem>(item.id, { decidedBy: 'you' });
  } else {
    session.update<ToolItem>(item.id, { decidedBy: g ? 'guard' : 'auto' });
  }

  session.update<ToolItem>(item.id, { status: 'running' });
  session.setActivity(label);
  pixie.show(TOOL_SPECS[call.tool].pixie, `${label}`, item.id);
  const started = performance.now();
  const out = await execute(call, targetPath, ctx);
  await pace(ctx, call.tool);
  const ms = Math.round(performance.now() - started);
  session.update<ToolItem>(item.id, { status: out.ok ? 'done' : 'failed', output: clip(out.text, 20_000), summary: out.summary, exitCode: out.exitCode, ms });
  const entry = await appendLedger('tool', `${label}: ${out.summary}`, { call: await ledgerCall(call), ok: out.ok, summary: out.summary, executed: true });
  session.timeline({ id: uid('e'), at: Date.now(), kind: 'tool', label: `${label}: ${out.summary}`, outcome: out.ok ? 'ok' : 'failed', itemId: item.id, ledgerSeq: entry.seq });

  if (call.tool === 'run_js') {
    session.output({ title: label, text: out.text, ok: out.ok });
    if (out.tests) {
      if (out.tests.fail === 0) {
        ctx.wins.testsPassed = true;
        pixie.show('celebrating', `All ${out.tests.total} tests pass`, item.id);
      } else pixie.show('debugging', `${out.tests.fail} of ${out.tests.total} tests fail`, item.id);
    }
  }
  if (call.tool === 'write_file' && out.ok) ctx.wins.edits++;
  const budget = ctx.provider.contextTokens <= 4096 ? 2400 : 12_000;
  return clip(out.text, budget);
}

interface ExecOutput extends ToolOutput {
  exitCode?: number;
  tests?: { total: number; pass: number; fail: number };
}

async function execute(call: ToolCall, targetPath: string, ctx: TurnContext): Promise<ExecOutput> {
  const ws = useWorkspace.getState();
  switch (call.tool) {
    case 'list_files':
      return execList(call.args);
    case 'read_file': {
      const out = execRead(call.args);
      if (out.ok) {
        const r = resolveWorkspacePath(call.args.path);
        if (!('error' in r)) workspace.openFile(r.path, parseInt(call.args.start_line ?? '', 10) || undefined);
      }
      return out;
    }
    case 'search':
      return execSearch(call.args);
    case 'write_file': {
      const before = ws.files[targetPath] ?? '';
      const after = call.args.content ?? '';
      const local = ws.kind === 'local';
      await workspace.write(targetPath, after);
      let diskNote = '';
      if (local) {
        try {
          diskNote = (await workspace.flush(targetPath)) ? ' and saved to disk' : ' (not saved to disk: folder access was not granted)';
        } catch {
          diskNote = ' (saving to disk failed)';
        }
      }
      workspace.openFile(targetPath);
      const st = diffStats(diffLines(before, after));
      return { ok: true, text: `Wrote ${targetPath}${diskNote}: +${st.added} −${st.removed} lines.`, summary: `+${st.added} −${st.removed} lines${diskNote}` };
    }
    case 'delete_file': {
      await workspace.remove(targetPath, { toDisk: ws.kind === 'local' });
      return { ok: true, text: `Deleted ${targetPath}.`, summary: 'Deleted' };
    }
    case 'run_js': {
      const entry = call.args.path ? resolveWorkspacePath(call.args.path) : null;
      if (entry && 'error' in entry) return { ok: false, text: entry.error, summary: 'Outside the workspace' };
      const r = await runInSandbox({ files: ws.files, entry: entry?.path, code: entry ? undefined : call.args.code });
      const summary = r.timedOut ? 'Timed out' : r.tests ? `${r.tests.pass}/${r.tests.total} tests pass` : r.ok ? 'Ran' : `Exited with code ${r.exitCode}`;
      return { ok: r.ok, text: r.output, summary, exitCode: r.exitCode, tests: r.tests };
    }
    case 'fetch_url':
      return execFetch(call.args, ctx.signal);
    case 'run_command':
      return { ok: false, text: 'Commands do not run in the browser.', summary: 'Not run' };
  }
}

// ---------------------------------------------------------------------------
// Prompting

const INTENT_HINT: Record<string, string> = {
  answer: 'answer directly; use tools only if you need to look something up',
  edit: 'the user wants a change: read the relevant code first, then edit',
  run: 'the user wants something run or tested',
  search: 'the user wants to find something: search first',
  research: 'the user wants an explanation grounded in the code',
};

function workspaceOutline(limit: number): string {
  const paths = Object.keys(useWorkspace.getState().files).sort();
  const shown = paths.slice(0, limit);
  return shown.join('\n') + (paths.length > shown.length ? `\n…and ${paths.length - shown.length} more (use list_files)` : '');
}

export function systemPrompt(ctx: TurnContext, json: boolean): string {
  const ws = useWorkspace.getState();
  const small = ctx.provider.contextTokens <= 4096;
  const parts = [
    `You are Glassbox, a careful coding agent inside a browser IDE, working on the project "${ws.name}".`,
    'Every tool call is checked by a guard before it runs. It may allow it, ask the user, or block it. If a call is blocked, do not repeat it: use a suggested alternative or explain.',
    'Read the relevant files before you change them. write_file must contain the complete new file. Keep edits small.',
    'run_command never runs here; it is only reviewed and shown to the user. To run tests, call run_js with the test file path (node:test and node:assert work).',
    'Write short, plain answers. When you mention code, cite it as path:line.',
  ];
  if (ctx.route) parts.push(`The router classified this request as "${ctx.route.intent}": ${INTENT_HINT[ctx.route.intent] ?? ''}.`);
  parts.push(`Workspace files:\n${workspaceOutline(small ? 40 : 150)}`);
  if (json) parts.push(protocolInstructions());
  return parts.join('\n\n');
}

/** Earlier turns, compressed to prompts, answers and what the agent did. */
function historyMessages(beforeItemId: string, budgetTokens: number): ChatMessage[] {
  const items = useSession.getState().items;
  const stop = items.findIndex((it) => it.id === beforeItemId);
  const prior = stop === -1 ? items : items.slice(0, stop);
  const turns: Array<{ user: string; answer: string; actions: string[] }> = [];
  for (const it of prior) {
    if (it.kind === 'user') turns.push({ user: it.text, answer: '', actions: [] });
    const cur = turns[turns.length - 1];
    if (!cur) continue;
    if (it.kind === 'assistant' && !it.aside && it.text.trim()) cur.answer = it.text.trim();
    if (it.kind === 'tool') cur.actions.push(`${describeCall(it.call)} → ${it.status}${it.summary ? ` (${it.summary})` : ''}`);
  }
  const msgs: ChatMessage[] = [];
  let used = 0;
  for (const t of turns.reverse()) {
    const answer = [t.answer, t.actions.length ? `[Actions: ${t.actions.slice(-6).join('; ')}]` : ''].filter(Boolean).join('\n');
    const cost = Math.ceil((t.user.length + answer.length) / 4);
    if (used + cost > budgetTokens) break;
    used += cost;
    msgs.unshift({ role: 'user', content: t.user }, { role: 'assistant', content: answer || '(no answer)' });
  }
  return msgs;
}

function trackUsage(res: ChatResult) {
  session.addCompute({ llmPrompt: res.usage.prompt, llmCompletion: res.usage.completion, llmEstimated: res.usage.estimated, llmCalls: 1 });
}

// ---------------------------------------------------------------------------
// The tool loop

async function nativeLoop(ctx: TurnContext, userItem: UserItem) {
  const tools = nativeToolSchemas();
  const budget = ctx.provider.contextTokens <= 4096 ? 400 : 4000;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(ctx, false) },
    ...historyMessages(userItem.id, budget),
    { role: 'user', content: userItem.text },
  ];
  for (let step = 0; step < MAX_STEPS; step++) {
    if (!ctx.provider.nativeTools) return jsonLoop(ctx, userItem, messages.slice(1));
    pixie.show('thinking', step === 0 ? 'Thinking about your request' : 'Deciding the next step');
    session.setActivity('Thinking');
    const assistant = session.add<AssistantItem>({ kind: 'assistant', id: uid('a'), text: '', streaming: true });
    let res: ChatResult;
    try {
      res = await ctx.provider.chat({
        messages,
        tools,
        signal: ctx.signal,
        onDelta: (d) => {
          session.appendText(assistant.id, d);
          if (d.trim()) pixie.show('typing', 'Writing a reply', assistant.id);
        },
      });
    } catch (err) {
      session.update<AssistantItem>(assistant.id, { streaming: false });
      if (!session.item<AssistantItem>(assistant.id)?.text.trim()) dropItem(assistant.id);
      if (err instanceof ProviderError && err.toolsUnsupported && !ctx.provider.nativeTools) {
        session.add<NoticeItem>({ kind: 'notice', id: uid('n'), tone: 'info', text: 'This model does not accept tool definitions, so the agent switched to the JSON action protocol.' });
        return jsonLoop(ctx, userItem, messages.slice(1));
      }
      throw err;
    }
    trackUsage(res);
    const hasCalls = res.toolCalls.length > 0;
    session.update<AssistantItem>(assistant.id, { text: res.text, streaming: false, aside: hasCalls });
    if (!res.text.trim()) dropItem(assistant.id);
    if (!hasCalls) return;
    messages.push({ role: 'assistant', content: res.text || null, tool_calls: res.toolCalls });
    for (const tc of res.toolCalls) {
      let parsed: unknown = {};
      try {
        parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: the arguments were not valid JSON. Try again.' });
        continue;
      }
      const args = coerceArgs(parsed);
      const problem = validateCall(tc.function.name, args);
      if (problem) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `Error: ${problem}` });
        continue;
      }
      const result = await guardedExecute({ tool: tc.function.name as ToolCall['tool'], args }, 'agent', ctx);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
  session.add<NoticeItem>({ kind: 'notice', id: uid('n'), tone: 'warn', text: `Stopped after ${MAX_STEPS} steps. Ask again to continue.` });
}

async function jsonLoop(ctx: TurnContext, userItem: UserItem, carried?: ChatMessage[]) {
  const budget = ctx.provider.contextTokens <= 4096 ? 300 : 3000;
  const base: ChatMessage[] = carried
    ? carried.filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls))
    : [...historyMessages(userItem.id, budget), { role: 'user', content: userItem.text }];
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(ctx, true) }, ...base];
  let retries = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    pixie.show('thinking', step === 0 ? 'Thinking about your request' : 'Deciding the next step');
    session.setActivity('Thinking');
    const aside = session.add<AssistantItem>({ kind: 'assistant', id: uid('a'), text: '', streaming: true, aside: true });
    const live: { answerId: string | null; raw: string } = { answerId: null, raw: '' };
    const res = await ctx.provider.chat({
      messages,
      jsonSchema: ACTION_SCHEMA,
      signal: ctx.signal,
      temperature: 0.1,
      maxTokens: ctx.provider.contextTokens <= 4096 ? 1100 : 1536,
      onDelta: (d) => {
        live.raw += d;
        session.update<AssistantItem>(aside.id, { text: partialField(live.raw, 'thought') });
        const answer = partialField(live.raw, 'answer');
        if (answer) {
          if (!live.answerId) live.answerId = session.add<AssistantItem>({ kind: 'assistant', id: uid('a'), text: '', streaming: true }).id;
          session.update<AssistantItem>(live.answerId, { text: answer });
          pixie.show('typing', 'Writing a reply', live.answerId);
        }
      },
    });
    trackUsage(res);
    const parsed = parseAction(res.text);
    session.update<AssistantItem>(aside.id, { streaming: false });
    if ('error' in parsed) {
      if (live.answerId) dropItem(live.answerId);
      if (retries < 2) {
        retries++;
        dropItem(aside.id);
        messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: correction(parsed.error) });
        continue;
      }
      // Give up on structure and show what the model said.
      session.update<AssistantItem>(aside.id, { text: res.text.trim() || 'The model did not produce a usable reply.', aside: false });
      return;
    }
    retries = 0;
    const action = parsed.action;
    session.update<AssistantItem>(aside.id, { text: action.thought });
    if (!action.thought.trim()) dropItem(aside.id);
    if (action.kind === 'final') {
      if (live.answerId) session.update<AssistantItem>(live.answerId, { text: action.answer, streaming: false });
      else session.add<AssistantItem>({ kind: 'assistant', id: uid('a'), text: action.answer, streaming: false });
      return;
    }
    if (live.answerId) dropItem(live.answerId);
    messages.push({ role: 'assistant', content: JSON.stringify({ thought: action.thought, tool: action.tool, args: action.args, answer: '' }) });
    const result = await guardedExecute({ tool: action.tool, args: action.args }, 'agent', ctx);
    messages.push({ role: 'user', content: `Result of ${action.tool}:\n${result}\n\nReply with the next JSON action.` });
    trimJsonContext(messages, ctx.provider.contextTokens);
  }
  session.add<NoticeItem>({ kind: 'notice', id: uid('n'), tone: 'warn', text: `Stopped after ${MAX_STEPS} steps. Ask again to continue.` });
}

/** Keep small models inside their context window by shortening old results. */
function trimJsonContext(messages: ChatMessage[], contextTokens: number) {
  // Code tokenises denser than prose, so count about 3.2 characters per token,
  // and leave room for the reply.
  const limit = contextTokens * (contextTokens <= 4096 ? 0.55 : 0.7);
  const size = () => messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length / 3.2 : 0), 0);
  for (let i = 2; i < messages.length - 2 && size() > limit; i++) {
    const m = messages[i];
    if (m.role === 'user' && m.content.startsWith('Result of') && m.content.length > 300) {
      messages[i] = { role: 'user', content: `${m.content.slice(0, 200)}\n…(older result shortened)` };
    }
  }
}

function dropItem(id: string) {
  useSession.setState((s) => ({ items: s.items.filter((it) => it.id !== id) }));
}

// ---------------------------------------------------------------------------
// Turns

let current: AbortController | null = null;

export function isRunning(): boolean {
  return useSession.getState().running;
}

export function stop() {
  current?.abort();
}

export interface TurnOptions {
  provider?: LlmProvider;
  forceResearch?: boolean;
  /** Let the router switch research mode on by itself (default true). */
  autoResearch?: boolean;
}

export async function runTurn(prompt: string, opts: TurnOptions = {}): Promise<TurnContext | null> {
  const text = prompt.trim();
  if (!text || isRunning()) return null;
  const resolved = opts.provider ?? resolveProvider();
  const userItem = session.add<UserItem>({ kind: 'user', id: uid('u'), text, at: Date.now() });
  if ('error' in resolved) {
    session.add<NoticeItem>({ kind: 'notice', id: uid('n'), tone: 'warn', text: resolved.error, pickModel: true });
    pixie.show('waiting', 'Pick a model to get started');
    return null;
  }
  const ctrl = new AbortController();
  current = ctrl;
  session.setRunning(true, 'Routing your request');
  const ctx: TurnContext = { provider: resolved, signal: ctrl.signal, wins: { edits: 0, testsPassed: false } };
  try {
    await ensureGlassbox();
    if (!glassboxReady()) {
      session.add<NoticeItem>({
        kind: 'notice',
        id: uid('n'),
        tone: 'warn',
        text: 'The glassbox models did not load, so prompts are not routed and tool calls are not checked. Every edit, run and fetch will ask you first.',
      });
    }
    pixie.show('thinking', 'Reading your request');
    const r = safeRoute(text);
    let research = useSettings.getState().research || !!opts.forceResearch;
    if (r) {
      ctx.route = r;
      account(r.compute, r.ms);
      const auto = !research && r.intent === 'research' && opts.autoResearch !== false;
      research = research || auto;
      const routeItem = session.add<RouteItem>({ kind: 'route', id: uid('r'), result: r, research, auto });
      const entry = await appendLedger('route', `Routed as ${r.intent}`, { prompt: text, intent: r.intent, scores: r.scores, margin: r.margin, clauses: r.evidence.map((e) => e.id), features: r.features, compute: r.compute, modelId: r.modelId });
      session.timeline({ id: uid('e'), at: Date.now(), kind: 'route', label: `Routed as ${r.intent}`, outcome: r.intent, itemId: routeItem.id, ledgerSeq: entry.seq });
      if (ctx.provider.scripted) await sleep(700, ctrl.signal);
    }
    if (research) await researchTurn(ctx, userItem);
    else if (ctx.provider.nativeTools) await nativeLoop(ctx, userItem);
    else await jsonLoop(ctx, userItem);
    if (ctx.wins.edits || ctx.wins.testsPassed) pixie.show('celebrating', ctx.wins.testsPassed ? 'Done, and the tests pass' : 'Done');
    else pixie.show('idle', 'Ready for the next request.');
    return ctx;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      session.add<NoticeItem>({ kind: 'notice', id: uid('n'), tone: 'info', text: 'Stopped.' });
      pixie.show('idle', 'Stopped.');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      session.add<NoticeItem>({ kind: 'notice', id: uid('n'), tone: 'error', text: message, pickModel: err instanceof ProviderError });
      pixie.show('error', 'Something went wrong. Details are in the chat.');
    }
    return null;
  } finally {
    // Settle anything still marked as in progress.
    useSession.setState((s) => ({
      items: s.items.map((it) => {
        if (it.kind === 'assistant' && it.streaming) return { ...it, streaming: false };
        if (it.kind === 'tool' && (it.status === 'checking' || it.status === 'awaiting' || it.status === 'running')) return { ...it, status: 'failed', note: 'Stopped before it finished.' };
        return it;
      }),
    }));
    if (current === ctrl) current = null;
    session.setRunning(false, '');
  }
}

/** Undo an applied edit, as long as the file still holds what the edit wrote. */
export async function revertEdit(itemId: string): Promise<boolean> {
  const item = session.item<ToolItem>(itemId);
  if (!item?.diff || item.status !== 'done' || item.reverted) return false;
  const ws = useWorkspace.getState();
  const { path, before, after, isNew } = item.diff;
  if (ws.files[path] !== after) {
    session.add<NoticeItem>({ kind: 'notice', id: uid('n'), tone: 'warn', text: `${path} changed after this edit, so it was not reverted.` });
    return false;
  }
  const toDisk = ws.kind === 'local';
  if (isNew) await workspace.remove(path, { toDisk });
  else {
    await workspace.write(path, before);
    if (toDisk) await workspace.flush(path).catch(() => false);
  }
  session.update<ToolItem>(itemId, { reverted: true, note: 'You reverted this edit.' });
  const entry = await appendLedger('human', `Reverted: ${describeCall(item.call)}`, { itemId, path });
  session.timeline({ id: uid('e'), at: Date.now(), kind: 'human', label: `You reverted: ${describeCall(item.call)}`, outcome: 'rejected', itemId, ledgerSeq: entry.seq });
  return true;
}

/** The person picked one of the guard's safer alternatives. */
export async function runRepair(itemId: string, repair: Repair) {
  if (isRunning()) return;
  const resolved = resolveProvider();
  const provider = 'error' in resolved ? getDemoProvider() : resolved;
  const ctrl = new AbortController();
  current = ctrl;
  session.setRunning(true, repair.title);
  const ctx: TurnContext = { provider: { ...provider, scripted: false }, signal: ctrl.signal, wins: { edits: 0, testsPassed: false } };
  try {
    const entry = await appendLedger('human', `Chose a safer alternative: ${repair.title}`, { itemId, repair: { title: repair.title, call: await ledgerCall(repair.call), why: repair.why } });
    session.timeline({ id: uid('e'), at: Date.now(), kind: 'human', label: `You chose: ${repair.title}`, outcome: 'chose', itemId, ledgerSeq: entry.seq });
    await guardedExecute(repair.call, 'you', ctx);
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      session.add<NoticeItem>({ kind: 'notice', id: uid('n'), tone: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    if (current === ctrl) current = null;
    session.setRunning(false, '');
  }
}
