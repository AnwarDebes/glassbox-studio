// In-browser models served by WebLLM (@mlc-ai/web-llm 0.2.87). The ids below
// exist in that version's prebuiltAppConfig; memory figures come from it too.
// Download sizes are approximate (4-bit weights plus tokenizer and config).

export interface LocalModel {
  key: string;
  name: string;
  maker: string;
  paramsBillions: number;
  /** Model id when the GPU supports 16-bit floats in shaders (smaller, faster). */
  idF16: string;
  /** Fallback model id for GPUs without shader-f16. */
  idF32: string;
  downloadGB: number;
  vramMB: { f16: number; f32: number };
  contextTokens: number;
  note: string;
  recommended?: boolean;
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    key: 'qwen-coder-1.5b',
    name: 'Qwen2.5-Coder 1.5B Instruct',
    maker: 'Qwen',
    paramsBillions: 1.5,
    idF16: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    idF32: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC',
    downloadGB: 0.9,
    vramMB: { f16: 1630, f32: 1889 },
    contextTokens: 4096,
    note: 'Best balance of speed and code skill on most laptops.',
    recommended: true,
  },
  {
    key: 'qwen-coder-3b',
    name: 'Qwen2.5-Coder 3B Instruct',
    maker: 'Qwen',
    paramsBillions: 3.1,
    idF16: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    idF32: 'Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC',
    downloadGB: 1.7,
    vramMB: { f16: 2505, f32: 2894 },
    contextTokens: 4096,
    note: 'Stronger at code. Needs a bit more memory.',
  },
  {
    key: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct',
    maker: 'Meta',
    paramsBillions: 3.2,
    idF16: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    idF32: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
    downloadGB: 1.8,
    vramMB: { f16: 2264, f32: 2952 },
    contextTokens: 4096,
    note: 'Good general reasoning and explanations.',
  },
  {
    key: 'phi-3.5-mini',
    name: 'Phi 3.5 mini Instruct',
    maker: 'Microsoft',
    paramsBillions: 3.8,
    idF16: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    idF32: 'Phi-3.5-mini-instruct-q4f32_1-MLC',
    downloadGB: 2.2,
    vramMB: { f16: 3672, f32: 5483 },
    contextTokens: 4096,
    note: 'The most capable here. Slowest to download.',
  },
];

export function localModelById(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find((m) => m.idF16 === id || m.idF32 === id);
}

export interface GpuReport {
  supported: boolean;
  f16: boolean;
  adapter?: string;
  reason?: string;
}

interface GpuAdapterLike {
  features: { has(name: string): boolean };
  info?: { vendor?: string; architecture?: string; description?: string };
}

let cached: Promise<GpuReport> | null = null;

/** Check WebGPU without loading WebLLM. */
export function checkWebGpu(): Promise<GpuReport> {
  if (cached) return cached;
  cached = (async (): Promise<GpuReport> => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(opts?: object): Promise<GpuAdapterLike | null> } }).gpu;
    if (!gpu) return { supported: false, f16: false, reason: 'This browser does not expose WebGPU. Try a recent Chrome or Edge on a desktop.' };
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return { supported: false, f16: false, reason: 'WebGPU is present but no GPU adapter is available.' };
      const name = [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' ');
      return { supported: true, f16: adapter.features.has('shader-f16'), adapter: name || undefined };
    } catch (err) {
      return { supported: false, f16: false, reason: err instanceof Error ? err.message : 'WebGPU check failed.' };
    }
  })();
  return cached;
}
