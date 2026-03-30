import type { RichMessage } from "shared";

interface ConversationEntry {
  messages: RichMessage[];
  lastAccessedAt: number;
  isStreaming: boolean;
  lastStreamedAt: number;
  userId: string;
  orgId: string;
  title: string;
  createdAt: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_MESSAGES_PER_CONVERSATION = 200;

const store = new Map<string, ConversationEntry>();

function now(): number {
  return Date.now();
}

function getOrCreate(conversationId: string): ConversationEntry {
  let entry = store.get(conversationId);
  if (!entry) {
    entry = {
      messages: [],
      lastAccessedAt: now(),
      isStreaming: false,
      lastStreamedAt: 0,
      userId: "",
      orgId: "",
      title: "",
      createdAt: now(),
    };
    store.set(conversationId, entry);
  } else {
    entry.lastAccessedAt = now();
  }
  return entry;
}

export function getConversation(conversationId: string): RichMessage[] {
  const entry = store.get(conversationId);
  if (!entry) return [];
  entry.lastAccessedAt = now();
  return entry.messages;
}

/**
 * Initialise metadata for a brand-new conversation (no-op if the conversation
 * already exists in the store). Call once per conversation before streaming.
 */
export function initConversation(
  conversationId: string,
  userId: string,
  orgId: string,
  title: string,
): void {
  if (store.has(conversationId)) return;
  store.set(conversationId, {
    messages: [],
    lastAccessedAt: now(),
    isStreaming: false,
    lastStreamedAt: 0,
    userId,
    orgId,
    title,
    createdAt: now(),
  });
}

export function appendMessages(
  conversationId: string,
  messages: RichMessage[],
): void {
  if (!messages.length) return;
  const entry = getOrCreate(conversationId);
  entry.messages = [...entry.messages, ...messages].slice(
    -MAX_MESSAGES_PER_CONVERSATION,
  );
}

export function clearConversation(conversationId: string): void {
  store.delete(conversationId);
}

/**
 * Mark a conversation as actively streaming. Call with `true` when a stream
 * starts and `false` when it completes (or errors/aborts).
 */
export function setStreaming(conversationId: string, streaming: boolean): void {
  const entry = getOrCreate(conversationId);
  entry.isStreaming = streaming;
  if (streaming) {
    entry.lastStreamedAt = now();
  }
}

/**
 * Update the lastStreamedAt timestamp for an active conversation. Called on
 * each SSE emit so that stale `isStreaming: true` flags (e.g. after a server
 * crash) can be detected by the client if lastStreamedAt is older than ~60s.
 */
export function touchStreamedAt(conversationId: string): void {
  const entry = store.get(conversationId);
  if (entry) {
    entry.lastStreamedAt = now();
  }
}

export interface ConversationStatus {
  isStreaming: boolean;
  lastStreamedAt: number;
  messages: RichMessage[];
}

export interface ConversationSummary {
  conversationId: string;
  title: string;
  createdAt: number;
  messageCount: number;
  isStreaming: boolean;
}

/**
 * Returns the full conversation including messages and streaming status.
 * Returns null if the conversation does not exist.
 */
export function getConversationStatus(
  conversationId: string,
): ConversationStatus | null {
  const entry = store.get(conversationId);
  if (!entry) return null;
  entry.lastAccessedAt = now();
  return {
    isStreaming: entry.isStreaming,
    lastStreamedAt: entry.lastStreamedAt,
    messages: entry.messages,
  };
}

/**
 * Find a persisted tool-result whose data includes the given snapshotId.
 */
export function findSnapshot(
  conversationId: string,
  snapshotId: string,
): RichMessage | undefined {
  const messages = getConversation(conversationId);
  for (const m of messages) {
    if (m.kind !== "tool-result") continue;
    const sid = m.data.snapshotId;
    if (sid === snapshotId) return m;
  }
  return undefined;
}

/**
 * Most recent tool-result for the given tool name, or undefined.
 */
export function getLatestToolResult(
  conversationId: string,
  toolName: string,
): RichMessage | undefined {
  const messages = getConversation(conversationId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.kind === "tool-result" && m.toolName === toolName) return m;
  }
  return undefined;
}

/**
 * Returns all non-empty conversations for a user, sorted newest-first.
 */
export function listConversations(
  userId: string,
  orgId: string,
): ConversationSummary[] {
  const results: ConversationSummary[] = [];
  for (const [conversationId, entry] of store.entries()) {
    if (entry.userId !== userId || entry.orgId !== orgId) continue;
    if (entry.messages.length === 0) continue;
    results.push({
      conversationId,
      title: entry.title,
      createdAt: entry.createdAt,
      messageCount: entry.messages.length,
      isStreaming: entry.isStreaming,
    });
  }
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

function cleanup(): void {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [id, entry] of store.entries()) {
    if (entry.lastAccessedAt < cutoff) {
      store.delete(id);
    }
  }
}

// Start cleanup interval — only in non-test environments to avoid leaking timers
if (process.env.NODE_ENV !== "test") {
  setInterval(cleanup, CLEANUP_INTERVAL_MS).unref();
}
