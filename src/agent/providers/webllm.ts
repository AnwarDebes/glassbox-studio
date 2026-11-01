import { ProviderError, estimateMessagesTokens, estimateTokens, type ChatMessage, type ChatRequest, type ChatResult, type LlmProvider } from '../types';
import { localModelById } from './webllm-models';

// Main-thread side of the WebLLM worker. Nothing here imports WebLLM itself,
// so the multi-megabyte runtime is fetched only when a local model is chosen.

export interface LoadProgress {
  progress: number;
  text: string;
}

type Outbound =
  | { type: 'progress'; progress: number; text: string }
  | { type: 'loaded'; modelId: string }
  | { type: 'delta'; id: string; delta: string }
  | { type: 'done'; id: string; text: string; prompt: number; completion: number }
  | { type: 'error'; id?: string; message: string };

let worker: Worker | null = null;
let loaded = '';
let loading: Promise<void> | null = null;
const listeners = new Set<(msg: Outbound) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module', name: 'webllm' });
    worker.onmessage = (e: MessageEvent<Outbound>) => listeners.forEach((l) => l(e.data));
  }
  return worker;
}

export function isLoaded(modelId: string): boolean {
  return loaded === modelId;
}

/** Download (or reuse from cache) and initialise a model. */
export function loadLocalModel(modelId: string, onProgress: (p: LoadProgress) => void): Promise<void> {
  if (loaded === modelId) return Promise.resolve();
  if (loading) return loading;
  const w = getWorker();
  loading = new Promise<void>((resolve, reject) => {
    const listener = (msg: Outbound) => {
      if (msg.type === 'progress') onProgress({ progress: msg.progress, text: msg.text });
      else if (msg.type === 'loaded' && msg.modelId === modelId) {
        listeners.delete(listener);
        loaded = modelId;
        loading = null;
        resolve();
      } else if (msg.type === 'error' && !msg.id) {
        listeners.delete(listener);
        loading = null;
        reject(new ProviderError(msg.message));
      }
    };
    listeners.add(listener);
    w.postMessage({ type: 'load', modelId });
  });
  return loading;
}

/** True when this browser already has the model's weights cached. */
export async function isModelCached(modelId: string): Promise<boolean> {
  try {
    if (!('caches' in window) || !(await caches.has('webllm/model'))) return false;
    const cache = await caches.open('webllm/model');
    const keys = await cache.keys();
    return keys.some((k) => k.url.includes(`/${modelId}/`));
  } catch {
    return false;
  }
}

function toWebLlmMessages(messages: ChatMessage[]) {
  // The JSON action protocol only uses system, user and assistant turns.
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'user' as const, content: m.content };
    if (m.role === 'assistant') return { role: 'assistant' as const, content: m.content ?? '' };
    return { role: m.role, content: m.content };
  });
}

let seq = 0;

export function createWebLlmProvider(modelId: string): LlmProvider {
  const meta = localModelById(modelId);
  return {
    id: 'webllm',
    label: 'In your browser',
    model: meta?.name ?? modelId,
    nativeTools: false,
    contextTokens: meta?.contextTokens ?? 4096,
    paramsBillions: meta?.paramsBillions,
    async chat(req: ChatRequest): Promise<ChatResult> {
      if (loaded !== modelId) throw new ProviderError('The in-browser model is not loaded. Open the model picker to load it.');
      const w = getWorker();
      const id = `c${++seq}`;
      return new Promise<ChatResult>((resolve, reject) => {
        const onAbort = () => w.postMessage({ type: 'abort' });
        req.signal.addEventListener('abort', onAbort, { once: true });
        const listener = (msg: Outbound) => {
          if (msg.type === 'delta' && msg.id === id) req.onDelta?.(msg.delta);
          else if (msg.type === 'done' && msg.id === id) {
            listeners.delete(listener);
            req.signal.removeEventListener('abort', onAbort);
            if (req.signal.aborted) {
              reject(new DOMException('Stopped', 'AbortError'));
              return;
            }
            resolve({
              text: msg.text,
              toolCalls: [],
              usage: {
                prompt: msg.prompt || estimateMessagesTokens(req.messages),
                completion: msg.completion || estimateTokens(msg.text),
                estimated: !msg.prompt,
              },
            });
          } else if (msg.type === 'error' && msg.id === id) {
            listeners.delete(listener);
            req.signal.removeEventListener('abort', onAbort);
            reject(new ProviderError(msg.message));
          }
        };
        listeners.add(listener);
        w.postMessage({
          type: 'chat',
          id,
          messages: toWebLlmMessages(req.messages),
          schema: req.jsonSchema ? JSON.stringify(req.jsonSchema) : undefined,
          temperature: req.temperature ?? 0.2,
          maxTokens: req.maxTokens ?? 1024,
        });
      });
    },
  };
}
