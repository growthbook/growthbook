/**
 * Ephemeral full payloads for tool results that must not be duplicated in the LLM-visible
 * tool return string. Incremental persistence uses peek; take is used when reconciling from
 * full ModelMessage[]; clearPendingToolArtifactsForConversation runs at end of each stream.
 */
const store = new Map<string, Record<string, unknown>>();

function makeKey(conversationId: string, toolCallId: string): string {
  return `${conversationId}\0${toolCallId}`;
}

export function setPendingToolArtifact(
  conversationId: string,
  toolCallId: string,
  data: Record<string, unknown>,
): void {
  store.set(makeKey(conversationId, toolCallId), data);
}

export function peekPendingToolArtifact(
  conversationId: string,
  toolCallId: string,
): Record<string, unknown> | undefined {
  return store.get(makeKey(conversationId, toolCallId));
}

export function takePendingToolArtifact(
  conversationId: string,
  toolCallId: string,
): Record<string, unknown> | undefined {
  const key = makeKey(conversationId, toolCallId);
  const value = store.get(key);
  store.delete(key);
  return value;
}

export function clearPendingToolArtifactsForConversation(
  conversationId: string,
): void {
  const prefix = `${conversationId}\0`;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
    }
  }
}
