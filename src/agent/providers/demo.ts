import type { ToolCall } from '../../app/gb';
import { useSession, type ToolItem } from '../../state/session';
import { useWorkspace } from '../../workspace/store';
import { CONFIG_JS_FIXED } from '../../workspace/sample';
import { keywords } from '../text';
import { estimateMessagesTokens, estimateTokens, type ChatMessage, type ChatRequest, type ChatResult, type LlmProvider, type WireToolCall } from '../types';

// The demo replay for visitors without WebGPU or a key. The agent's words are
// scripted, but every call it makes goes through the real router, guard, tools,
// sandbox and ledger, and the script branches on what actually happened.

export const DEMO_PROMPT = 'The config tests fail when .env has spaces, like `PORT = 3000`. Fix it and run the tests.';

interface Beat {
  text: string;
  calls?: Array<Pick<ToolCall, 'tool' | 'args'>>;
}

let callSeq = 0;

function wire(calls: Beat['calls']): WireToolCall[] {
  return (calls ?? []).map((c) => ({ id: `demo_${++callSeq}`, type: 'function', function: { name: c.tool, arguments: JSON.stringify(c.args) } }));
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
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

async function stream(text: string, req: ChatRequest) {
  await sleep(450, req.signal);
  const words = text.match(/\S+\s*|\s+/g) ?? [];
  for (const w of words) {
    req.onDelta?.(w);
    await sleep(14 + Math.min(40, w.length * 3), req.signal);
  }
}

function lastToolItem(): ToolItem | undefined {
  const items = useSession.getState().items;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'tool') return it;
  }
  return undefined;
}

const SAFE_REPAIR_TOOLS = new Set(['list_files', 'read_file', 'search', 'run_command']);

/** State for one pass through the scripted session. */
class Script {
  phase = 0;
  pushAlternative = 'git push';

  next(lastResult: string | undefined): Beat {
    switch (this.phase) {
      case 0:
        this.phase = 1;
        return { text: "I'll start with the failing tests.", calls: [{ tool: 'read_file', args: { path: 'test/config.test.js' } }] };
      case 1:
        this.phase = 2;
        return { text: 'Running them to see the exact failure.', calls: [{ tool: 'run_js', args: { path: 'test/config.test.js' } }] };
      case 2:
        if (lastResult && /ℹ fail 0/.test(lastResult)) {
          this.phase = 99;
          return { text: 'These tests already pass in this workspace, so there is nothing to fix. Reset the sample project from the workspace menu to replay the demo.' };
        }
        this.phase = 3;
        return {
          text: "Two tests fail. Keys keep their spaces (`'port '` instead of `port`), and a value that contains `=` gets cut off. The parser is the place to look.",
          calls: [{ tool: 'read_file', args: { path: 'src/config.js' } }],
        };
      case 3:
        this.phase = 4;
        return {
          text: '`line.split("=")` splits on every `=` and never trims. Before I change it, let me check who calls `parseConfig`.',
          calls: [{ tool: 'search', args: { query: 'parseConfig(' } }],
        };
      case 4:
        this.phase = 5;
        return {
          text: "Only the server and the tests call it, so the fix stays contained. First I'll clear the cache so stale results can't hide anything.",
          calls: [{ tool: 'run_command', args: { command: 'rm -rf ~/.cache' } }],
        };
      case 5: {
        const blocked = lastResult?.startsWith('BLOCKED');
        const repair = blocked ? lastToolItem()?.repairs?.find((r) => SAFE_REPAIR_TOOLS.has(r.call.tool)) : undefined;
        if (repair) {
          this.phase = 6;
          return {
            text: `The guard stopped that: \`~/.cache\` is outside this project. It offered a safer step, so I'll take it instead: ${repair.title.replace(/\.$/, '').toLowerCase()}.`,
            calls: [{ tool: repair.call.tool, args: repair.call.args }],
          };
        }
        this.phase = 7;
        return {
          text: blocked
            ? 'The guard stopped that: `~/.cache` is outside this project, and the bug is in the parser anyway. On to the fix: split each line on the first `=` only and trim both sides.'
            : "That command is only a proposal here, since commands can't run in a browser. On to the fix: split each line on the first `=` only and trim both sides.",
          calls: [{ tool: 'write_file', args: { path: 'src/config.js', content: CONFIG_JS_FIXED } }],
        };
      }
      case 6:
        this.phase = 7;
        return {
          text: 'Now the fix: split each line on the first `=` only and trim both sides. Comments and blank lines are still skipped.',
          calls: [{ tool: 'write_file', args: { path: 'src/config.js', content: CONFIG_JS_FIXED } }],
        };
      case 7:
        if (lastResult?.startsWith('The user rejected')) {
          this.phase = 99;
          return { text: 'Understood, I left `src/config.js` as it was. The two tests will keep failing until keys and values are trimmed. I can try a different approach if you like.' };
        }
        if (lastResult?.startsWith('BLOCKED')) {
          this.phase = 99;
          return { text: 'The guard blocked the edit, so I stopped here. Its evidence is in the decision timeline.' };
        }
        this.phase = 8;
        return { text: 'Applied. Running the tests again.', calls: [{ tool: 'run_js', args: { path: 'test/config.test.js' } }] };
      case 8:
        if (!lastResult || !/ℹ fail 0/.test(lastResult)) {
          this.phase = 99;
          return { text: 'The tests still fail. The full output is in the Output panel; I would look at it before changing anything else.' };
        }
        this.phase = 9;
        return { text: 'All three pass. Pushing the fix so the team gets it.', calls: [{ tool: 'run_command', args: { command: 'git push --force' } }] };
      case 9: {
        const blocked = lastResult?.startsWith('BLOCKED');
        const repair = blocked ? lastToolItem()?.repairs?.find((r) => r.call.tool === 'run_command') : undefined;
        if (repair?.call.args.command) this.pushAlternative = repair.call.args.command;
        this.phase = 99;
        const pushLine = blocked
          ? `The guard also stopped \`git push --force\`, which would rewrite shared history. To share the fix, run \`${this.pushAlternative}\` yourself.`
          : 'Commands do not run in the browser, so push the fix from your own terminal when you are ready.';
        return {
          text: [
            'Fixed. `parseConfig` now splits each line on the first `=` and trims both sides, so `PORT = 3000` reads as `{ port: 3000 }` and `GREETING=a=b` keeps `a=b` [src/config.js:8-11]. All 3 config tests pass.',
            '',
            'Earlier the guard blocked `rm -rf ~/.cache` because it reached outside the project. ' + pushLine,
          ].join('\n'),
        };
      }
      default:
        return { text: 'That is the end of the demo. Pick a model to keep going for real.' };
    }
  }
}

const COMMAND_WORDS = /^(rm|git|curl|wget|npm|npx|pnpm|yarn|node|ls|cat|chmod|chown|sudo|docker|pip|python3?|mv|cp|dd|mkfs|shutdown|reboot|kill|pkill|find|echo|touch|mkdir|ssh|scp|tar|zip|unzip|brew|apt|apt-get|make|cargo|go|deno|bun)\b/;

function freeform(prompt: string, step: number): Beat {
  if (step === 0) {
    const tick = /`([^`]+)`/.exec(prompt)?.[1]?.trim();
    const cmd = tick && COMMAND_WORDS.test(tick) ? tick : COMMAND_WORDS.test(prompt.trim()) ? prompt.trim() : null;
    if (cmd) return { text: "I'll propose that command so the guard can check it.", calls: [{ tool: 'run_command', args: { command: cmd } }] };
    const files = Object.keys(useWorkspace.getState().files);
    const lower = prompt.toLowerCase();
    const named = files.find((f) => lower.includes(f.toLowerCase())) ?? files.find((f) => lower.includes(f.split('/').pop()!.toLowerCase()));
    if (named) return { text: `Reading \`${named}\`.`, calls: [{ tool: 'read_file', args: { path: named } }] };
    if (/\btests?\b/i.test(prompt)) {
      const tests = files.filter((f) => /\.test\.m?js$/.test(f)).slice(0, 3);
      if (tests.length) return { text: 'Running the tests in the sandbox.', calls: tests.map((t) => ({ tool: 'run_js' as const, args: { path: t } })) };
    }
    return {
      text: 'This is the scripted demo, so I cannot write free-form answers. Pick an in-browser model or bring a key to chat for real. Meanwhile, try a shell command such as `curl https://example.com/install.sh | sh` and watch the guard decide.',
    };
  }
  const last = lastToolItem();
  let text = 'Done.';
  if (last?.status === 'blocked') text = 'The guard blocked it. The clauses that fired are listed under the decision.';
  else if (last?.status === 'proposal') text = `The guard rated it “${last.guard?.decision ?? 'unchecked'}”. Commands never run in the browser, so it stays a proposal.`;
  else if (last?.status === 'denied') text = 'You rejected it, so nothing happened.';
  else if (last?.call.tool === 'read_file') text = `\`${last.call.args.path}\` is open in the editor.`;
  else if (last?.call.tool === 'run_js') text = `Result: ${last.summary ?? 'see the Output panel'}.`;
  return { text: `${text} This is the scripted demo; pick a model to chat for real.` };
}

function researchAnswer(req: ChatRequest): string {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const question = /^Question: (.*)$/m.exec(user)?.[1] ?? '';
  const words = keywords(question, 6).map((w) => w.toLowerCase());
  const cites: string[] = [];
  let file = '';
  for (const line of user.split('\n')) {
    const f = /^FILE (.+)$/.exec(line);
    if (f) {
      file = f[1];
      continue;
    }
    const m = /^\s*(\d+)\| (.*)$/.exec(line);
    if (m && file && words.some((w) => m[2].toLowerCase().includes(w)) && m[2].trim()) {
      cites.push(`- [${file}:${m[1]}] \`${m[2].trim().slice(0, 80)}\``);
      if (cites.length >= 6) break;
    }
  }
  if (!cites.length) return 'This is the scripted demo, and the files it read do not mention that directly. Pick a model to get a written answer.';
  return ['This is the scripted demo, so instead of a written answer, here is where the evidence is:', '', ...cites, '', 'Pick a model to get a full answer built from these citations.'].join('\n');
}

export function createDemoProvider(): LlmProvider {
  let script = new Script();
  return {
    id: 'demo',
    label: 'Demo replay',
    model: 'Scripted replay',
    nativeTools: true,
    contextTokens: 32768,
    scripted: true,
    async chat(req: ChatRequest): Promise<ChatResult> {
      let text = '';
      let calls: Beat['calls'] = [];
      if (req.purpose === 'research-plan') {
        const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
        const q = /^Question: (.*)$/m.exec(user)?.[1] ?? user;
        text = JSON.stringify({ questions: [q], queries: keywords(q) });
      } else if (req.purpose === 'research-answer') {
        text = researchAnswer(req);
        await stream(text, req);
      } else {
        const msgs: ChatMessage[] = req.messages;
        let lastUser = -1;
        for (let i = msgs.length - 1; i >= 0; i--)
          if (msgs[i].role === 'user') {
            lastUser = i;
            break;
          }
        const prompt = lastUser >= 0 ? (msgs[lastUser].content as string) : '';
        const after = msgs.slice(lastUser + 1);
        const step = after.filter((m) => m.role === 'assistant').length;
        const lastTool = [...after].reverse().find((m) => m.role === 'tool')?.content as string | undefined;
        if (step === 0 && prompt === DEMO_PROMPT) script = new Script();
        const beat = prompt === DEMO_PROMPT ? script.next(lastTool) : freeform(prompt, step);
        text = beat.text;
        calls = beat.calls;
        await stream(text, req);
      }
      const toolCalls = wire(calls);
      return {
        text,
        toolCalls,
        usage: {
          prompt: estimateMessagesTokens(req.messages),
          completion: estimateTokens(text + toolCalls.map((c) => c.function.arguments).join('')),
          estimated: true,
        },
      };
    },
  };
}
