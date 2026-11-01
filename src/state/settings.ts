import { create } from 'zustand';
import { local } from '../workspace/persist';

export type ThemePref = 'system' | 'dark' | 'light';

export type ModelChoice =
  | { kind: 'demo' }
  | { kind: 'webllm'; modelId: string }
  | { kind: 'remote'; providerId: string };

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  nativeTools: boolean;
}

export type BottomTab = 'decisions' | 'ledger' | 'output';

export interface SettingsState {
  theme: ThemePref;
  guard: boolean;
  showWork: boolean;
  askEdits: boolean;
  research: boolean;
  model: ModelChoice;
  providers: Record<string, ProviderConfig>;
  bottomTab: BottomTab;
  bottomOpen: boolean;
}

const KEY = 'gbx.settings';

const defaults: SettingsState = {
  theme: 'system',
  guard: true,
  showWork: true,
  askEdits: true,
  research: false,
  model: { kind: 'demo' },
  providers: {},
  bottomTab: 'decisions',
  bottomOpen: true,
};

export const useSettings = create<SettingsState>(() => ({ ...defaults, ...local.get<Partial<SettingsState>>(KEY, {}) }));

useSettings.subscribe((s) => local.set(KEY, s));

export function setSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
  useSettings.setState({ [key]: value } as Pick<SettingsState, K>);
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === 'system') localStorage.removeItem('gbx.theme');
    else localStorage.setItem('gbx.theme', pref);
  } catch {
    /* ignore */
  }
}

export function effectiveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
