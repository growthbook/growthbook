import type { ModelMessage } from "ai";

interface ConversationEntry {
  messages: ModelMessage[];
  lastAccessedAt: number;
  isStreaming: boolean;
  lastStreamedAt: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_MESSAGES_PER_CONVERSATION = 100;

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
    };
    store.set(conversationId, entry);
  } else {
    entry.lastAccessedAt = now();
  }
  return entry;
}

export function getConversation(conversationId: string): ModelMessage[] {
  const entry = store.get(conversationId);
  if (!entry) return [];
  entry.lastAccessedAt = now();
  return entry.messages;
}

export function appendMessages(
  conversationId: string,
  messages: ModelMessage[],
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
  messages: ModelMessage[];
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
