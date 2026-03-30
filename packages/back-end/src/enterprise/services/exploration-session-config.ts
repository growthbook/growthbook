import type { ExplorationConfig } from "shared/validators";

/**
 * Latest exploration config per conversation during an in-flight agent stream.
 * Persisted messages are only appended when the stream completes, so multiple
 * runExploration calls in one turn need this to compute snapshot summaries.
 */
const lastExplorationConfigByConversation = new Map<
  string,
  ExplorationConfig
>();

export function getSessionLatestExplorationConfig(
  conversationId: string,
): ExplorationConfig | undefined {
  return lastExplorationConfigByConversation.get(conversationId);
}

export function setSessionLatestExplorationConfig(
  conversationId: string,
  config: ExplorationConfig,
): void {
  lastExplorationConfigByConversation.set(conversationId, config);
}

export function clearSessionLatestExplorationConfig(
  conversationId: string,
): void {
  lastExplorationConfigByConversation.delete(conversationId);
}

/** Per-request counter so multiple runExploration calls in one stream get unique snapshot IDs. */
const snapshotSlotByConversation = new Map<string, number>();

export function resetSnapshotSlotCounter(conversationId: string): void {
  snapshotSlotByConversation.delete(conversationId);
}

export function nextSnapshotSlot(conversationId: string): number {
  const n = (snapshotSlotByConversation.get(conversationId) ?? 0) + 1;
  snapshotSlotByConversation.set(conversationId, n);
  return n;
}
