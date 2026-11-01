// Provider-neutral chat types, shaped like the OpenAI chat completions API
// that every supported provider speaks.

export interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: WireToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: 'string'; description: string }>;
      required: string[];
      additionalProperties?: boolean;
    };
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Native function calling. Omitted for the JSON action protocol. */
  tools?: ToolSchema[];
  /** Ask for a JSON object, constrained to this schema where the runtime supports it. */
  jsonSchema?: object;
  signal: AbortSignal;
  onDelta?: (text: string) => void;
  temperature?: number;
  maxTokens?: number;
  /** What the call is for; only the scripted demo reads it. */
  purpose?: 'research-plan' | 'research-answer';
}

export interface ChatUsage {
  prompt: number;
  completion: number;
  estimated: boolean;
}

export interface ChatResult {
  text: string;
  toolCalls: WireToolCall[];
  usage: ChatUsage;
}

export interface LlmProvider {
  id: string;
  label: string;
  /** Short model name for chips and status lines. */
  model: string;
  /** Native tool calling, or the strict JSON action protocol. */
  nativeTools: boolean;
  /** Approximate context window in tokens, used to trim history. */
  contextTokens: number;
  /** Rough parameter count in billions, when known. */
  paramsBillions?: number;
  /** True for the scripted demo replay. */
  scripted?: boolean;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly toolsUnsupported = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** About four characters per token for English and code. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    n += 4;
    if (typeof m.content === 'string') n += estimateTokens(m.content);
    if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) n += estimateTokens(c.function.arguments) + 8;
  }
  return n;
}
