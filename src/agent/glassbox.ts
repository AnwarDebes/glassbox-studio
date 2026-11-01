import { create } from 'zustand';
import { loadGlassbox, type ModelCard } from '../app/gb';

// Loads the Tsetlin Machine models (small JSON files) once per page.

interface GlassboxState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  cards: ModelCard[];
  error?: string;
}

export const useGlassbox = create<GlassboxState>(() => ({ status: 'idle', cards: [] }));

let loading: Promise<boolean> | null = null;

export function ensureGlassbox(): Promise<boolean> {
  if (loading) return loading;
  useGlassbox.setState({ status: 'loading' });
  loading = loadGlassbox(`${import.meta.env.BASE_URL}models/`)
    .then((cards) => {
      useGlassbox.setState({ status: 'ready', cards });
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
