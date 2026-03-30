/**
 * Snapshots created during an active stream are not in the conversation store until
 * the request finishes. getSnapshot must resolve them by ID for same-turn tool calls.
 */
export interface PendingSnapshotPayload {
  summary: string;
  snapshotId: string;
  config: unknown;
  exploration: unknown;
  resultCsv: string | null;
}

const store = new Map<string, PendingSnapshotPayload>();

function makeKey(conversationId: string, snapshotId: string): string {
  return `${conversationId}\0${snapshotId}`;
}

export function registerPendingSnapshot(
  conversationId: string,
  payload: PendingSnapshotPayload,
): void {
  store.set(makeKey(conversationId, payload.snapshotId), payload);
}

export function getPendingSnapshot(
  conversationId: string,
  snapshotId: string,
): PendingSnapshotPayload | undefined {
  return store.get(makeKey(conversationId, snapshotId));
}

export function clearPendingSnapshotsForConversation(
  conversationId: string,
): void {
  const prefix = `${conversationId}\0`;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
    }
  }
}
