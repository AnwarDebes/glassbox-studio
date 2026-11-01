import { create } from 'zustand';
import { loadGlassbox, type ModelCard, type ModelJSON, type ModelLoader } from '../app/gb';

// Loads the Tsetlin Machine models (small JSON files) once per page.

/** Figures from a model file that the model cards do not carry. */
export interface ModelStats {
  features: number;
  bytes: number;
  heldOut: { accuracy: number; n: number };
  challenge?: { accuracy: number; n: number };
}

interface GlassboxState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  cards: ModelCard[];
  stats: Record<string, ModelStats>;
  error?: string;
}

export const useGlassbox = create<GlassboxState>(() => ({ status: 'idle', cards: [], stats: {} }));

let loading: Promise<boolean> | null = null;

export function ensureGlassbox(): Promise<boolean> {
  if (loading) return loading;
  useGlassbox.setState({ status: 'loading' });
  const stats: Record<string, ModelStats> = {};
  // Read each model file once, keeping its size and evaluation blocks for the model list.
  const loader: ModelLoader = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not load ${url}: HTTP ${res.status}`);
    const text = await res.text();
    const json = JSON.parse(text) as ModelJSON;
    const { heldOut, challenge } = json.metrics;
    stats[json.id] = {
      features: json.features.length,
      bytes: new TextEncoder().encode(text).length,
      heldOut: { accuracy: heldOut.accuracy, n: heldOut.n },
      challenge: challenge ? { accuracy: challenge.accuracy, n: challenge.n } : undefined,
    };
    return json;
  };
  loading = loadGlassbox(`${import.meta.env.BASE_URL}models/`, loader)
    .then((cards) => {
      useGlassbox.setState({ status: 'ready', cards, stats });
      return true;
    })
    .catch((err: unknown) => {
      useGlassbox.setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      loading = null;
      return false;
    });
  return loading;
}

export function glassboxReady(): boolean {
  return useGlassbox.getState().status === 'ready';
}

/** The guard model's card (the one that decides allow, ask or block). */
export function guardCard(cards: ModelCard[]): ModelCard | undefined {
  return cards.find((c) => c.classes.includes('block')) ?? cards[0];
}

export function routerCard(cards: ModelCard[]): ModelCard | undefined {
  return cards.find((c) => c.classes.includes('research') || c.classes.includes('edit'));
}

export function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
