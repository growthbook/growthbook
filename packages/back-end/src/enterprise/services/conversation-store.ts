import type { ModelMessage } from "ai";

interface ConversationEntry {
  messages: ModelMessage[];
  lastAccessedAt: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_MESSAGES_PER_CONVERSATION = 100;

const store = new Map<string, ConversationEntry>();

function now(): number {
  return Date.now();
}

function getOrCreateConversation(sessionId: string): ConversationEntry {
  let entry = store.get(sessionId);
  if (!entry) {
    entry = { messages: [], lastAccessedAt: now() };
    store.set(sessionId, entry);
  } else {
    entry.lastAccessedAt = now();
  }
  return entry;
}

export function getConversation(sessionId: string): ModelMessage[] {
  const entry = store.get(sessionId);
  if (!entry) return [];
  entry.lastAccessedAt = now();
  return entry.messages;
}

export function appendMessages(
  sessionId: string,
  messages: ModelMessage[],
): void {
  if (!messages.length) return;
  const entry = getOrCreateConversation(sessionId);
  entry.messages = [...entry.messages, ...messages].slice(
    -MAX_MESSAGES_PER_CONVERSATION,
  );
}

export function clearConversation(sessionId: string): void {
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
