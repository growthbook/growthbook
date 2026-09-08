import { genUUID } from "../../util";
import type { SessionStorageCompat } from "../../types/growthbook";
import { getSessionStorage } from "./storage";

type StoredIdState = {
  id: string;
  createdAt: number;
  lastActiveAt: number;
};

export type PersistedEphemeralIdConfig = {
  // Storage key; also the field holding the id inside the stored JSON
  key: string;
  // Rotate after this much inactivity; each read refreshes the window
  idleTimeoutMs?: number;
  // Rotate this long after creation, regardless of activity
  maxDurationMs?: number;
  // Storage medium; defaults to (polyfill-aware) sessionStorage
  storage?: () => SessionStorageCompat | undefined;
};

type GetOrCreateOptions = {
  forceNew?: boolean;
  idleTimeoutMs?: number;
  maxDurationMs?: number;
};

const TOUCH_THROTTLE_MS = 1000;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Mint-once persisted ephemeral ID, valid within the configured time bounds.
// Falls back to in-memory state when storage is unavailable.
export function createPersistedEphemeralId(config: PersistedEphemeralIdConfig) {
  const getStorage = config.storage ?? getSessionStorage;
  let inMemoryFallback: StoredIdState | null = null;

  function normalize(value: unknown): StoredIdState | null {
    const stored = value as Record<string, unknown> | null;
    if (!stored) return null;

    const id = stored[config.key];
    const createdAt = finiteNumber(stored.createdAt);
    const lastActiveAt = finiteNumber(stored.lastActiveAt);
    if (
      typeof id !== "string" ||
      !id ||
      createdAt === null ||
      lastActiveAt === null
    ) {
      return null;
    }

    return { id, createdAt, lastActiveAt };
  }

  function read(): StoredIdState | null {
    try {
      const raw = getStorage()?.getItem(config.key) as
        | string
        | null
        | undefined;
      if (raw) {
        const stored = normalize(JSON.parse(raw));
        if (stored) return stored;
      }
    } catch {
      // fall through to the in-memory copy
    }
    return inMemoryFallback;
  }

  // Write through to memory so degraded storage (quota errors, async-only
  // polyfills) still yields a stable ID for this JS context
  function persist(state: StoredIdState): void {
    inMemoryFallback = state;
    try {
      getStorage()?.setItem(
        config.key,
        JSON.stringify({
          [config.key]: state.id,
          createdAt: state.createdAt,
          lastActiveAt: state.lastActiveAt,
        }),
      );
    } catch {
      // the in-memory copy above still applies
    }
  }

  function getOrCreate(options?: GetOrCreateOptions): string {
    const idleTimeoutMs = options?.idleTimeoutMs ?? config.idleTimeoutMs;
    const maxDurationMs = options?.maxDurationMs ?? config.maxDurationMs;
    const now = Date.now();
    const stored = options?.forceNew ? null : read();

    if (
      stored &&
      (idleTimeoutMs === undefined ||
        now - stored.lastActiveAt < idleTimeoutMs) &&
      (maxDurationMs === undefined || now - stored.createdAt < maxDurationMs)
    ) {
      // Every event read counts as activity; throttle the write
      if (
        idleTimeoutMs !== undefined &&
        now - stored.lastActiveAt >= TOUCH_THROTTLE_MS
      ) {
        persist({ ...stored, lastActiveAt: now });
      }
      return stored.id;
    }

    const fresh: StoredIdState = {
      id: genUUID(globalThis.crypto),
      createdAt: now,
      lastActiveAt: now,
    };
    persist(fresh);
    return fresh.id;
  }

  function reset(): void {
    inMemoryFallback = null;
  }

  return { getOrCreate, reset };
}
