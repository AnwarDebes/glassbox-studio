// Bring-your-own-key providers. All speak the OpenAI chat completions API.
// Model ids change often, so every preset can list live models with "Fetch".

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  needsKey: boolean;
  keyUrl?: string;
  models: string[];
  nativeTools: boolean;
  /** What is free about it, in a few words. */
  free: string;
  /** Setup hint shown under the form. */
  hint?: string;
  local?: boolean;
  /** Extra headers some providers like to see. */
  headers?: Record<string, string>;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'],
    nativeTools: true,
    free: 'Free tier with rate limits',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    models: ['qwen/qwen3-coder:free', 'openai/gpt-oss-20b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3.1:free'],
    nativeTools: true,
    free: 'Models ending in :free cost nothing',
    headers: { 'X-Title': 'Glassbox Studio' },
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    nativeTools: true,
    free: 'Free tier in Google AI Studio',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    models: ['devstral-small-latest', 'mistral-small-latest', 'codestral-latest'],
    nativeTools: true,
    free: 'Free Experiment plan',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    needsKey: true,
    keyUrl: 'https://cloud.cerebras.ai',
    models: ['gpt-oss-120b', 'qwen-3-32b', 'llama-3.3-70b', 'llama3.1-8b'],
    nativeTools: true,
    free: 'Free tier with daily limits',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    models: ['qwen2.5-coder:7b', 'qwen3:8b', 'llama3.2'],
    nativeTools: true,
    free: 'Runs on your machine',
    hint: 'Start Ollama with OLLAMA_ORIGINS set to this page’s origin so the browser may call it.',
    local: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    models: [],
    nativeTools: true,
    free: 'Runs on your machine',
    hint: 'Start the local server in LM Studio and turn on “Enable CORS”.',
    local: true,
  },
  {
    id: 'custom',
    name: 'Custom endpoint',
    baseUrl: '',
    needsKey: false,
    models: [],
    nativeTools: true,
    free: 'Any OpenAI-compatible API',
    hint: 'Paste a base URL that ends before /chat/completions, for example https://host/v1.',
  },
];

export const PRESET_BY_ID: Record<string, ProviderPreset> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || 'the provider';
  }
}
