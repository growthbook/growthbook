import { genUUID } from "../util";

type StoredSessionReplayState = {
  sessionReplayId: string;
  lastTouchedAt: number;
};

const SESSION_STORAGE_KEY = "gb_session";
export const SESSION_REPLAY_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

let inMemorySessionReplayFallback: StoredSessionReplayState | null = null;

function normalizeStoredSessionReplayState(
  value: unknown,
): StoredSessionReplayState | null {
  const stored = value as Record<string, unknown> | null;
  const sessionReplayId =
    typeof stored?.sessionReplayId === "string" ? stored.sessionReplayId : "";

  if (
    !sessionReplayId ||
    typeof stored?.lastTouchedAt !== "number" ||
    !Number.isFinite(stored.lastTouchedAt)
  ) {
    return null;
  }

  return {
    sessionReplayId,
    lastTouchedAt: stored.lastTouchedAt,
  };
}

function readStoredSessionReplayState(): StoredSessionReplayState | null {
  let stored: StoredSessionReplayState | null = null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    stored = raw ? normalizeStoredSessionReplayState(JSON.parse(raw)) : null;
  } catch {
    return inMemorySessionReplayFallback;
  }

  if (!inMemorySessionReplayFallback) return stored;
  if (!stored) return inMemorySessionReplayFallback;

  if (stored.lastTouchedAt >= inMemorySessionReplayFallback.lastTouchedAt) {
    inMemorySessionReplayFallback = null;
    return stored;
  }

  return inMemorySessionReplayFallback;
}

function persistSessionReplayState(state: StoredSessionReplayState): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
    inMemorySessionReplayFallback = null;
  } catch {
    inMemorySessionReplayFallback = state;
  }
}

export function getOrCreateSessionReplayId(forceNew = false): string {
  const now = Date.now();
  const stored = forceNew ? null : readStoredSessionReplayState();

  if (stored && now - stored.lastTouchedAt < SESSION_REPLAY_IDLE_TIMEOUT_MS) {
    const touched = { ...stored, lastTouchedAt: now };
    persistSessionReplayState(touched);
    return touched.sessionReplayId;
  }

  const fresh: StoredSessionReplayState = {
    sessionReplayId: genUUID(window.crypto),
    lastTouchedAt: now,
  };
  persistSessionReplayState(fresh);
  return fresh.sessionReplayId;
}

export function touchSessionReplayId(): void {
  const now = Date.now();
  const stored = readStoredSessionReplayState();

  if (!stored || now - stored.lastTouchedAt >= SESSION_REPLAY_IDLE_TIMEOUT_MS) {
    return;
  }

  persistSessionReplayState({ ...stored, lastTouchedAt: now });
}
