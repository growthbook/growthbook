import { genUUID } from "../../util";
import { getSessionStorage } from "./storage";

type StoredIdState = {
  id: string;
  timestamp: number;
};

export type PersistedEphemeralIdConfig = {
  storageKey: string;
  // Field names used in the stored JSON, so each ID keeps its wire format
  idField: string;
  timestampField: string;
  // Older field names still accepted on read
  legacyIdFields?: string[];
  // "fixed" expires relative to creation; "idle" refreshes the timestamp on
  // every read so the ID only expires after a quiet gap
  expiry: "fixed" | "idle";
  durationMs: number;
};

// Mint-once, sessionStorage-persisted ephemeral ID with an in-memory
// fallback when storage is unavailable (e.g. incognito windows, Node).
export function createPersistedEphemeralId(config: PersistedEphemeralIdConfig) {
  let inMemoryFallback: StoredIdState | null = null;

  function normalize(value: unknown): StoredIdState | null {
    const stored = value as Record<string, unknown> | null;
    if (!stored) return null;

    let id = "";
    for (const field of [config.idField, ...(config.legacyIdFields ?? [])]) {
      const candidate = stored[field];
      if (typeof candidate === "string" && candidate) {
        id = candidate;
        break;
      }
    }

    const timestamp = stored[config.timestampField];
    if (!id || typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      return null;
    }

    return { id, timestamp };
  }

  function read(): StoredIdState | null {
    try {
      const raw = getSessionStorage()?.getItem(config.storageKey) as
        | string
        | null
        | undefined;
      if (!raw) return null;
      return normalize(JSON.parse(raw));
    } catch {
      return inMemoryFallback;
    }
  }

  function persist(state: StoredIdState): void {
    const storage = getSessionStorage();
    if (!storage) {
      inMemoryFallback = state;
      return;
    }
    try {
      storage.setItem(
        config.storageKey,
        JSON.stringify({
          [config.idField]: state.id,
          [config.timestampField]: state.timestamp,
        }),
      );
    } catch {
      inMemoryFallback = state;
    }
  }

  function getOrCreate(options?: {
    forceNew?: boolean;
    durationMs?: number;
  }): string {
    const durationMs = options?.durationMs ?? config.durationMs;
    const now = Date.now();
    const stored = options?.forceNew ? null : read();

    if (stored && now - stored.timestamp < durationMs) {
      if (config.expiry === "idle") {
        persist({ id: stored.id, timestamp: now });
      }
      return stored.id;
    }

    const fresh: StoredIdState = {
      id: genUUID(globalThis.crypto),
      timestamp: now,
    };
    persist(fresh);
    return fresh.id;
  }

  return { getOrCreate };
}
