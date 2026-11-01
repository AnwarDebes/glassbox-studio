// Runs WebLLM off the main thread so Pixie and the editor stay smooth while a
// model loads or generates. Loaded only when someone picks an in-browser model.
import { CreateMLCEngine, type MLCEngine, type ChatCompletionMessageParam } from '@mlc-ai/web-llm';

type Inbound =
  | { type: 'load'; modelId: string }
  | {
      type: 'chat';
      id: string;
      messages: ChatCompletionMessageParam[];
      schema?: string;
      temperature: number;
      maxTokens: number;
    }
  | { type: 'abort' };

let engine: MLCEngine | null = null;
let loadedId = '';

const post = (msg: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);

self.onmessage = async (event: MessageEvent<Inbound>) => {
  const msg = event.data;
  try {
    if (msg.type === 'load') {
      if (engine && loadedId === msg.modelId) {
        post({ type: 'loaded', modelId: msg.modelId });
        return;
      }
      if (engine) await engine.unload();
      engine = await CreateMLCEngine(msg.modelId, {
        initProgressCallback: (r) => post({ type: 'progress', progress: r.progress, text: r.text }),
      });
      loadedId = msg.modelId;
      post({ type: 'loaded', modelId: msg.modelId });
      return;
    }
    if (msg.type === 'abort') {
      await engine?.interruptGenerate();
      return;
    }
    if (msg.type === 'chat') {
      if (!engine) throw new Error('The model is not loaded yet.');
      const stream = await engine.chat.completions.create({
        messages: msg.messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: msg.temperature,
        max_tokens: msg.maxTokens,
        response_format: msg.schema ? { type: 'json_object', schema: msg.schema } : undefined,
      });
      let text = '';
      let prompt = 0;
      let completion = 0;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          text += delta;
          post({ type: 'delta', id: msg.id, delta });
        }
        if (chunk.usage) {
          prompt = chunk.usage.prompt_tokens;
          completion = chunk.usage.completion_tokens;
        }
      }
      post({ type: 'done', id: msg.id, text, prompt, completion });
    }
  } catch (err) {
    post({ type: 'error', id: msg.type === 'chat' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
