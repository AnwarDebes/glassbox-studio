import { pixie } from '../pixie/director';
import { session, uid, type AssistantItem, type PlanItem, type PlanStep, type UserItem } from '../state/session';
import { useWorkspace } from '../workspace/store';
import { guardedExecute, type TurnContext } from './runtime';
import type { ChatMessage, ChatResult } from './types';
import { keywords } from './text';

// Research mode: plan, search and read across the workspace, then answer with
// file:line citations. The steps are orchestrated here rather than left to the
// model, so it works with small in-browser models too. Every search and read
// still goes through the guard.

function track(res: ChatResult) {
  session.addCompute({ llmPrompt: res.usage.prompt, llmCompletion: res.usage.completion, llmEstimated: res.usage.estimated, llmCalls: 1 });
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    questions: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    queries: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  },
  required: ['questions', 'queries'],
  additionalProperties: false,
};

async function plan(ctx: TurnContext, prompt: string): Promise<{ questions: string[]; queries: string[] }> {
  const fallback = { questions: [prompt], queries: keywords(prompt) };
  const files = Object.keys(useWorkspace.getState().files).slice(0, 60).join('\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You plan research in a codebase. Reply with JSON only: {"questions": [up to 3 short sub-questions], "queries": [up to 4 short search strings likely to appear in the code, such as function names or config keys]}.',
    },
    { role: 'user', content: `Question: ${prompt}\n\nFiles:\n${files}` },
  ];
  try {
    const res = await ctx.provider.chat({ messages, jsonSchema: PLAN_SCHEMA, signal: ctx.signal, temperature: 0.1, maxTokens: 300, purpose: 'research-plan' });
    track(res);
    const start = res.text.indexOf('{');
    const end = res.text.lastIndexOf('}');
    const obj = JSON.parse(res.text.slice(start, end + 1)) as { questions?: unknown; queries?: unknown };
    const questions = Array.isArray(obj.questions) ? obj.questions.filter((q): q is string => typeof q === 'string' && !!q.trim()).slice(0, 3) : [];
    const queries = Array.isArray(obj.queries) ? obj.queries.filter((q): q is string => typeof q === 'string' && !!q.trim()).slice(0, 4) : [];
    return { questions: questions.length ? questions : fallback.questions, queries: queries.length ? queries : fallback.queries };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return fallback;
  }
}

export async function researchTurn(ctx: TurnContext, userItem: UserItem) {
  const prompt = userItem.text;
  const steps: PlanStep[] = [
    { text: 'Plan what to look for', status: 'doing' },
    { text: 'Search the workspace', status: 'todo' },
    { text: 'Read the most relevant files', status: 'todo' },
    { text: 'Answer with citations', status: 'todo' },
  ];
  const planItem = session.add<PlanItem>({ kind: 'plan', id: uid('p'), title: 'Research', steps });
  const setStep = (i: number, patch: Partial<PlanStep>) => {
    const cur = session.item<PlanItem>(planItem.id);
    if (!cur) return;
    session.update<PlanItem>(planItem.id, { steps: cur.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  };

  pixie.show('thinking', 'Planning the research', planItem.id);
  session.setActivity('Planning');
  const { questions, queries } = await plan(ctx, prompt);
  setStep(0, { status: 'done', text: `Plan: ${questions.join('; ')}` });

  // Search.
  setStep(1, { status: 'doing', text: `Search for ${queries.map((q) => `“${q}”`).join(', ') || 'the question'}` });
  const hits = new Map<string, number>();
  for (const q of queries) {
    const text = await guardedExecute({ tool: 'search', args: { query: q } }, 'agent', ctx);
    for (const line of text.split('\n')) {
      const m = /^(.+?):(\d+): /.exec(line);
      if (m) hits.set(m[1], (hits.get(m[1]) ?? 0) + 1);
    }
  }
  setStep(1, { status: 'done' });

  // Rank files: search hits first, then names that match the question.
  const files = Object.keys(useWorkspace.getState().files);
  const words = queries.map((q) => q.toLowerCase());
  const score = (p: string) => (hits.get(p) ?? 0) * 3 + (words.some((w) => p.toLowerCase().includes(w)) ? 2 : 0) + (/^(readme|docs\/)/i.test(p) ? 0.5 : 0);
  const small = ctx.provider.contextTokens <= 4096;
  const top = files
    .filter((p) => score(p) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, small ? 2 : 4);
  if (!top.length) top.push(...files.filter((p) => /^readme/i.test(p)).slice(0, 1));

  setStep(2, { status: 'doing', text: top.length ? `Read ${top.join(', ')}` : 'Nothing relevant found to read' });
  const contexts: string[] = [];
  for (const path of top) {
    const text = await guardedExecute({ tool: 'read_file', args: { path, end_line: small ? '120' : '300' } }, 'agent', ctx);
    if (/^(BLOCKED|The user rejected|No file named)/.test(text)) continue;
    contexts.push(`FILE ${path}\n${text}`);
  }
  setStep(2, { status: 'done' });

  // Answer.
  setStep(3, { status: 'doing' });
  pixie.show('typing', 'Writing the answer with citations', planItem.id);
  session.setActivity('Writing the answer');
  const answer = session.add<AssistantItem>({ kind: 'assistant', id: uid('a'), text: '', streaming: true });
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You answer questions about a codebase using only the files provided. Cite each claim as [path:line] or [path:start-end] using the line numbers shown. If the files do not contain the answer, say so plainly. Be concise: a short paragraph or a few bullets.',
    },
    { role: 'user', content: `Question: ${prompt}\n\n${contexts.length ? contexts.join('\n\n') : '(No relevant files were found.)'}` },
  ];
  const res = await ctx.provider.chat({
    messages,
    signal: ctx.signal,
    temperature: 0.2,
    maxTokens: 900,
    purpose: 'research-answer',
    onDelta: (d) => session.appendText(answer.id, d),
  });
  track(res);
  session.update<AssistantItem>(answer.id, { text: res.text, streaming: false });
  setStep(3, { status: 'done' });
}
