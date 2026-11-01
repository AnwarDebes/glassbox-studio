import { create } from 'zustand';
import { local } from '../workspace/persist';

export type PickerTab = 'browser' | 'key' | 'glassbox';

interface UiState {
  picker: PickerTab | null;
  drawer: boolean;
  sideWidth: number;
  agentWidth: number;
  toast: { id: number; text: string; tone: 'info' | 'error' | 'success' } | null;
}

const sizes = local.get<{ side?: number; agent?: number }>('gbx.layout', {});

export const useUi = create<UiState>(() => ({
  picker: null,
  drawer: false,
  sideWidth: sizes.side ?? 252,
  agentWidth: sizes.agent ?? 430,
  toast: null,
}));

useUi.subscribe((s, prev) => {
  if (s.sideWidth !== prev.sideWidth || s.agentWidth !== prev.agentWidth) local.set('gbx.layout', { side: s.sideWidth, agent: s.agentWidth });
});

export function openPicker(tab: PickerTab = 'browser') {
  useUi.setState({ picker: tab });
}

export function closePicker() {
  useUi.setState({ picker: null });
}

let toastId = 0;
export function toast(text: string, tone: 'info' | 'error' | 'success' = 'info') {
  const id = ++toastId;
  useUi.setState({ toast: { id, text, tone } });
  setTimeout(() => {
    if (useUi.getState().toast?.id === id) useUi.setState({ toast: null });
  }, 4200);
}

/** Scroll the transcript to an item and flash it. */
export function revealItem(id: string) {
  const el = document.getElementById(`item-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}
