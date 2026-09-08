import { getPolyfills } from "../../util";
import type { SessionStorageCompat } from "../../types/growthbook";

export function getSessionStorage(): SessionStorageCompat | undefined {
  try {
    return getPolyfills().sessionStorage ?? globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function getLocalStorage(): SessionStorageCompat | undefined {
  try {
    return getPolyfills().localStorage ?? globalThis.localStorage;
  } catch {
    return undefined;
  }
}

// Returns null when the key is missing, storage is unavailable, or the
// stored value is not valid JSON.
export function readSessionJSON(key: string): unknown {
  try {
    const storage = getSessionStorage();
    const raw = storage
      ? (storage.getItem(key) as string | null | undefined)
      : undefined;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Returns false when storage is unavailable or the write fails.
export function writeSessionJSON(key: string, value: unknown): boolean {
  const storage = getSessionStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
