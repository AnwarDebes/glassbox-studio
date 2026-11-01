import { ProviderError, estimateMessagesTokens, estimateTokens, type ChatRequest, type ChatResult, type LlmProvider, type WireToolCall } from '../types';
import { hostOf, type ProviderPreset } from './presets';

interface OpenAiOptions {
  preset: ProviderPreset;
  baseUrl: string;
  model: string;
  apiKey: string;
  nativeTools: boolean;
}

function trimSlash(u: string) {
  return u.replace(/\/+$/, '');
}

function headers(preset: ProviderPreset, apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(preset.headers ?? {}) };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

async function explain(res: Response, preset: ProviderPreset, baseUrl: string): Promise<ProviderError> {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
      detail = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message ?? body;
    } catch {
      detail = body;
    }
  } catch {
    /* no body */
  }
  detail = detail.slice(0, 300);
  const host = hostOf(baseUrl);
  if (res.status === 401 || res.status === 403) return new ProviderError(`${preset.name} rejected the key (${res.status}). Check it in the model picker.`, res.status);
  if (res.status === 404) return new ProviderError(`${host} has no such model or endpoint (404). ${detail}`.trim(), 404);
  if (res.status === 429) return new ProviderError(`${preset.name} is rate limiting this key (429). Wait a moment or pick another model.`, 429);
  const toolsUnsupported = res.status === 400 && /tool|function/i.test(detail);
  return new ProviderError(`${preset.name} returned ${res.status}. ${detail}`.trim(), res.status, toolsUnsupported);
}

function networkError(err: unknown, preset: ProviderPreset, baseUrl: string): Error {
  if (err instanceof DOMException && err.name === 'AbortError') return err;
  const host = hostOf(baseUrl);
  const local = preset.local || /localhost|127\.0\.0\.1/.test(baseUrl);
  const hint = local
    ? `Is it running, and does it allow requests from ${location.origin}? ${preset.hint ?? ''}`
    : 'The request was blocked before it reached the provider (offline, or the provider does not allow browser requests).';
  return new ProviderError(`Could not reach ${host}. ${hint}`.trim());
}

export function createOpenAiProvider(opts: OpenAiOptions): LlmProvider {
  const base = trimSlash(opts.baseUrl);
  let native = opts.nativeTools;

  const provider: LlmProvider = {
    id: opts.preset.id,
    label: opts.preset.name,
    model: opts.model,
    get nativeTools() {
      return native;
    },
    contextTokens: opts.preset.local ? 8192 : 32768,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: req.messages,
        stream: true,
        temperature: req.temperature ?? 0.2,
      };
      if (req.maxTokens) body.max_tokens = req.maxTokens;
      if (req.tools && native) {
        body.tools = req.tools;
        body.tool_choice = 'auto';
      }
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: headers(opts.preset, opts.apiKey),
          body: JSON.stringify(body),
          signal: req.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch (err) {
        throw networkError(err, opts.preset, base);
      }
      if (!res.ok) {
        const e = await explain(res, opts.preset, base);
        if (e.toolsUnsupported && native) {
          // Fall back to the JSON action protocol for the rest of the session.
          native = false;
        }
        throw e;
      }

      const type = res.headers.get('content-type') ?? '';
      let text = '';
      const calls = new Map<number, WireToolCall>();
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

      if (!type.includes('text/event-stream') || !res.body) {
        const j = (await res.json()) as {
          choices?: Array<{ message?: { content?: string | null; tool_calls?: WireToolCall[] } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const msg = j.choices?.[0]?.message;
        text = msg?.content ?? '';
        if (text) req.onDelta?.(text);
        (msg?.tool_calls ?? []).forEach((c, i) => calls.set(i, c));
        usage = j.usage;
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let chunk: {
              choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              error?: { message?: string };
            };
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }
            if (chunk.error?.message) throw new ProviderError(`${opts.preset.name}: ${chunk.error.message}`);
            if (chunk.usage) usage = chunk.usage;
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;
            if (delta.content) {
              text += delta.content;
              req.onDelta?.(delta.content);
            }
            for (const tc of delta.tool_calls ?? []) {
              const idx = tc.index ?? calls.size;
              const cur = calls.get(idx) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.function.name += tc.function.name;
              if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
              calls.set(idx, cur);
            }
          }
        }
      }

      const toolCalls = [...calls.values()]
        .filter((c) => c.function.name)
        .map((c, i) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}_${i}` }));
      const estimated = !usage?.prompt_tokens;
      return {
        text,
        toolCalls,
        usage: {
          prompt: usage?.prompt_tokens ?? estimateMessagesTokens(req.messages),
          completion: usage?.completion_tokens ?? estimateTokens(text + toolCalls.map((c) => c.function.arguments).join('')),
          estimated,
        },
      };
    },
  };
  return provider;
}

/** List model ids from a provider's /models endpoint. */
export async function fetchModels(preset: ProviderPreset, baseUrl: string, apiKey: string): Promise<string[]> {
  const base = trimSlash(baseUrl);
  let res: Response;
  try {
    res = await fetch(`${base}/models`, { headers: headers(preset, apiKey), credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (err) {
    throw networkError(err, preset, base);
  }
  if (!res.ok) throw await explain(res, preset, base);
  const j = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ id?: string; name?: string }> };
  const ids = (j.data ?? []).map((m) => m.id).concat((j.models ?? []).map((m) => m.id ?? m.name ?? '')).filter(Boolean);
  const cleaned = ids.map((id) => id.replace(/^models\//, ''));
  return [...new Set(cleaned)].sort();
}
