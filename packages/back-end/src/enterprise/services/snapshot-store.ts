import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";

export interface ServerSnapshot {
  id: string;
  timestamp: string;
  summary: string;
  config: ExplorationConfig;
  exploration: ProductAnalyticsExploration | null;
  resultCsv: string | null;
}

interface SessionEntry {
  snapshots: ServerSnapshot[];
  lastAccessedAt: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SNAPSHOTS_PER_SESSION = 20;

const store = new Map<string, SessionEntry>();

function now(): number {
  return Date.now();
}

function getOrCreateSession(sessionId: string): SessionEntry {
  let entry = store.get(sessionId);
  if (!entry) {
    entry = { snapshots: [], lastAccessedAt: now() };
    store.set(sessionId, entry);
  } else {
    entry.lastAccessedAt = now();
  }
  return entry;
}

export function addSnapshot(
  sessionId: string,
  data: Omit<ServerSnapshot, "id" | "timestamp">,
): ServerSnapshot {
  const entry = getOrCreateSession(sessionId);
  const id = `snap_${sessionId.slice(0, 8)}_${entry.snapshots.length + 1}`;
  const snapshot: ServerSnapshot = {
    id,
    timestamp: new Date().toISOString(),
    ...data,
  };
  entry.snapshots = [
    ...entry.snapshots.slice(-(MAX_SNAPSHOTS_PER_SESSION - 1)),
    snapshot,
  ];
  return snapshot;
}

export function getSnapshot(
  sessionId: string,
  snapshotId: string,
): ServerSnapshot | undefined {
  const entry = store.get(sessionId);
  if (!entry) return undefined;
  entry.lastAccessedAt = now();
  return entry.snapshots.find((s) => s.id === snapshotId);
}

export function getSessionSnapshots(sessionId: string): ServerSnapshot[] {
  const entry = store.get(sessionId);
  if (!entry) return [];
  entry.lastAccessedAt = now();
  return entry.snapshots;
}

export function getLatestSnapshot(
  sessionId: string,
): ServerSnapshot | undefined {
  const entry = store.get(sessionId);
  if (!entry || !entry.snapshots.length) return undefined;
  entry.lastAccessedAt = now();
  return entry.snapshots[entry.snapshots.length - 1];
}

export function clearSession(sessionId: string): void {
  store.delete(sessionId);
}

function cleanup(): void {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [sessionId, entry] of store.entries()) {
    if (entry.lastAccessedAt < cutoff) {
      store.delete(sessionId);
    }
  }
}

// Start cleanup interval — only in non-test environments to avoid leaking timers
if (process.env.NODE_ENV !== "test") {
  setInterval(cleanup, CLEANUP_INTERVAL_MS).unref();
}
