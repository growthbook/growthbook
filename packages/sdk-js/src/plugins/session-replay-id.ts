type StoredSessionReplayState = {
  session_replay_id: string;
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
    typeof stored?.session_replay_id === "string"
      ? stored.session_replay_id
      : typeof stored?.id === "string"
        ? stored.id
        : "";

  if (
    !sessionReplayId ||
    typeof stored?.lastTouchedAt !== "number" ||
    !Number.isFinite(stored.lastTouchedAt)
  ) {
    return null;
  }

  return {
    session_replay_id: sessionReplayId,
    lastTouchedAt: stored.lastTouchedAt,
  };
}

function readStoredSessionReplayState(): StoredSessionReplayState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return inMemorySessionReplayFallback;
    return normalizeStoredSessionReplayState(JSON.parse(raw));
  } catch {
    return inMemorySessionReplayFallback;
  }
}

function persistSessionReplayState(state: StoredSessionReplayState): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
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
    return touched.session_replay_id;
  }

  const fresh: StoredSessionReplayState = {
    session_replay_id: genUUID(window.crypto),
    lastTouchedAt: now,
  };
  persistSessionReplayState(fresh);
  return fresh.session_replay_id;
}

// Use the browser's crypto.randomUUID if set to generate a UUID.
export function genUUID(crypto?: Crypto) {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return ("" + 1e7 + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => {
    const n =
      crypto && crypto.getRandomValues
        ? crypto.getRandomValues(new Uint8Array(1))[0]
        : Math.floor(Math.random() * 256);
    return (
      (c as unknown as number) ^
      (n & (15 >> ((c as unknown as number) / 4)))
    ).toString(16);
  });
}
