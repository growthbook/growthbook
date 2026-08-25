import { genUUID, getPolyfills } from "../util";

type StoredGbSessionState = {
  gbSessionId: string;
  createdAt: number;
};

const SESSION_STORAGE_KEY = "gb_session";
export const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;

let inMemoryFallback: StoredGbSessionState | null = null;

function getSessionStorage() {
  return getPolyfills().sessionStorage ?? globalThis.sessionStorage;
}

function normalizeStoredGbSessionState(
  value: unknown,
): StoredGbSessionState | null {
  const stored = value as Record<string, unknown> | null;

  if (
    typeof stored?.gbSessionId !== "string" ||
    !stored.gbSessionId ||
    typeof stored?.createdAt !== "number" ||
    !Number.isFinite(stored.createdAt)
  ) {
    return null;
  }

  return { gbSessionId: stored.gbSessionId, createdAt: stored.createdAt };
}

function readStoredGbSessionState(): StoredGbSessionState | null {
  try {
    const raw = getSessionStorage().getItem(SESSION_STORAGE_KEY) as
      | string
      | null;
    if (!raw) return null;
    return normalizeStoredGbSessionState(JSON.parse(raw));
  } catch {
    return inMemoryFallback;
  }
}

function persistGbSessionState(state: StoredGbSessionState): void {
  try {
    getSessionStorage().setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    inMemoryFallback = state;
  }
}

export function getOrCreateGbSessionId(options?: {
  forceNew?: boolean;
  maxDuration?: number;
}): string {
  const forceNew = !!options?.forceNew;
  const maxDuration = options?.maxDuration ?? DEFAULT_MAX_DURATION_MS;
  const now = Date.now();
  const stored = forceNew ? null : readStoredGbSessionState();

  if (stored && now - stored.createdAt < maxDuration) {
    return stored.gbSessionId;
  }

  const fresh: StoredGbSessionState = {
    gbSessionId: genUUID(globalThis.crypto),
    createdAt: now,
  };
  persistGbSessionState(fresh);
  return fresh.gbSessionId;
}
