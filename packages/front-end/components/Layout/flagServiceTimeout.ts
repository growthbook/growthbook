// Stores that the flag service did not answer in time, never which shell won.
const FLAG_SERVICE_TIMEOUT_KEY = "gb-flag-service-timed-out-at";
export const FLAG_SERVICE_TIMEOUT_MEMORY_MS = 24 * 60 * 60 * 1000;

export function skipFlagServiceWait({
  now,
  stored,
  sdkReady,
}: {
  now: number;
  stored: string | null;
  sdkReady: boolean;
}): boolean {
  if (sdkReady || stored === null || !/^\d+$/.test(stored)) return false;
  const age = now - Number(stored);
  return age >= 0 && age < FLAG_SERVICE_TIMEOUT_MEMORY_MS;
}

// localStorage throws when storage is blocked, as in some private windows.
export function readFlagServiceTimeout(): string | null {
  try {
    return window.localStorage.getItem(FLAG_SERVICE_TIMEOUT_KEY);
  } catch {
    return null;
  }
}

export function rememberFlagServiceTimeout(now: number) {
  try {
    window.localStorage.setItem(FLAG_SERVICE_TIMEOUT_KEY, String(now));
  } catch {
    // Without storage, every load waits as before.
  }
}

export function forgetFlagServiceTimeout() {
  try {
    window.localStorage.removeItem(FLAG_SERVICE_TIMEOUT_KEY);
  } catch {
    // Nothing was stored.
  }
}
