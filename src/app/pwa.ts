import { create } from 'zustand';

// Install and update state for the progressive web app.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  canInstall: boolean;
  installed: boolean;
  needRefresh: boolean;
  offlineReady: boolean;
}

export const usePwa = create<PwaState>(() => ({
  canInstall: false,
  installed: typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
  needRefresh: false,
  offlineReady: false,
}));

let deferred: BeforeInstallPromptEvent | null = null;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

/** Call once, as early as possible, so the install event is not missed. */
export function capturePwaEvents() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    usePwa.setState({ canInstall: false, installed: true });
  });
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  usePwa.setState({ canInstall: false, installed: outcome === 'accepted' });
  return outcome;
}

export async function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
      onOfflineReady: () => usePwa.setState({ offlineReady: true }),
    });
  } catch {
    /* service workers can be unavailable (private mode, file://) */
  }
}

export function applyUpdate() {
  void updateSW?.(true);
}

export function dismissPwaToasts() {
  usePwa.setState({ needRefresh: false, offlineReady: false });
}
