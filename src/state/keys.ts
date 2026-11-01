// API keys never leave this browser except in the Authorization header of a
// request to the provider they belong to. By default they live only in memory
// for this tab; "Remember on this device" stores them in localStorage.

const memory = new Map<string, string>();
const prefix = 'gbx.key.';

export function getKey(providerId: string): string {
  const inMemory = memory.get(providerId);
  if (inMemory) return inMemory;
  try {
    return localStorage.getItem(prefix + providerId) ?? '';
  } catch {
    return '';
  }
}

export function isRemembered(providerId: string): boolean {
  try {
    return localStorage.getItem(prefix + providerId) != null;
  } catch {
    return false;
  }
}

export function setKey(providerId: string, key: string, remember: boolean) {
  const value = key.trim();
  if (value) memory.set(providerId, value);
  else memory.delete(providerId);
  try {
    if (remember && value) localStorage.setItem(prefix + providerId, value);
    else localStorage.removeItem(prefix + providerId);
  } catch {
    /* storage blocked: the key stays in memory only */
  }
}

export function forgetKey(providerId: string) {
  memory.delete(providerId);
  try {
    localStorage.removeItem(prefix + providerId);
  } catch {
    /* ignore */
  }
}
