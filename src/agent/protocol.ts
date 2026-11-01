import type { ToolName } from '../app/gb';
import { TOOL_NAMES, TOOL_SPECS, coerceArgs, toolReference, validateCall } from './tools';

// The strict JSON action protocol, for models without native tool calling
// (the in-browser models). Each reply is exactly one JSON object.

export type Action =
  | { kind: 'tool'; thought: string; tool: ToolName; args: Record<string, string> }
  | { kind: 'final'; thought: string; answer: string };

const ARG_KEYS = [...new Set(TOOL_NAMES.flatMap((t) => Object.keys(TOOL_SPECS[t].params)))];

/** JSON schema handed to WebLLM's grammar engine so output is always parseable. */
export const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    thought: { type: 'string' },
    tool: { type: 'string', enum: [...TOOL_NAMES, 'final'] },
    args: {
      type: 'object',
      properties: Object.fromEntries(ARG_KEYS.map((k) => [k, { type: 'string' }])),
      additionalProperties: false,
    },
    answer: { type: 'string' },
  },
  required: ['thought', 'tool', 'args', 'answer'],
  additionalProperties: false,
};

export function protocolInstructions(): string {
  return [
    'Reply with exactly one JSON object and nothing else:',
    '{"thought": "<one short sentence>", "tool": "<tool name or final>", "args": {<string arguments>}, "answer": "<your answer when tool is final, else empty>"}',
    '',
    'Tools:',
    toolReference(),
    '',
    'Use one tool per reply. You will get the result, then choose the next step.',
    'When the task is done, reply with tool "final" and put your answer for the user in "answer".',
    'Example: {"thought": "I should look at the parser first.", "tool": "read_file", "args": {"path": "src/config.js"}, "answer": ""}',
  ].join('\n');
}

/** Pull the first balanced JSON object out of a reply, tolerating code fences and chatter. */
function extractObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAction(text: string): { action: Action } | { error: string } {
  const raw = extractObject(text);
  if (!raw) return { error: 'The reply did not contain a JSON object.' };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    return { error: `The JSON did not parse (${err instanceof Error ? err.message : 'syntax error'}).` };
  }
  const thought = typeof obj.thought === 'string' ? obj.thought : '';
  const tool = typeof obj.tool === 'string' ? obj.tool.trim() : '';
  if (tool === 'final' || (!tool && typeof obj.answer === 'string' && obj.answer)) {
    const answer = typeof obj.answer === 'string' ? obj.answer : '';
    if (!answer.trim()) return { error: 'tool was "final" but "answer" was empty.' };
    return { action: { kind: 'final', thought, answer } };
  }
  const args = coerceArgs(obj.args);
  const problem = validateCall(tool, args);
  if (problem) return { error: problem };
  return { action: { kind: 'tool', thought, tool: tool as ToolName, args } };
}

export function correction(error: string): string {
  return `Your last reply could not be used: ${error} Reply again with exactly one JSON object in the format described, and nothing else.`;
}

/** Read a string field out of a partial JSON reply while it streams. */
export function partialField(text: string, field: 'thought' | 'answer'): string {
  const m = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(text);
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1].replace(/\\$/, '')}"`) as string;
  } catch {
    return m[1];
  }
}
