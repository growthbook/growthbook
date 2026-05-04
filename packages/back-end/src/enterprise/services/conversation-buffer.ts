import type { AIChatMessage, AIChatToolResultPart } from "shared/ai-chat";
import type { AIChatFeedbackEntry } from "shared/validators";
import { logger } from "back-end/src/util/logger";
import type { AIConversationModel } from "back-end/src/models/AIConversationModel";

// ---------------------------------------------------------------------------
// ConversationBuffer — the interface between streaming code and storage.
//
// Created per-request by loadOrInitConversation(), threaded through the
// agent handler / StreamProcessor / tools, and persisted to MongoDB at
// request boundaries. The buffer lives on the stack and is GC'd when the
// handler returns — no module-level Map, no eviction, no sweep.
//
// The interface is the abstraction boundary: today LocalConversationBuffer
// is a plain object; a future pub-sub implementation can wrap or replace it
// to broadcast mutations to other nodes.
// ---------------------------------------------------------------------------

const MAX_MESSAGES_PER_CONVERSATION = 200;

export interface ConversationBufferSnapshot {
  messages: AIChatMessage[];
  title: string;
  isStreaming: boolean;
  lastStreamedAt: number;
  lastAccessedAt: number;
  model: string | undefined;
  agentType: string;
}

export interface ConversationBuffer {
  readonly conversationId: string;

  // Read
  getMessages(): AIChatMessage[];
  getLatestToolResult(toolName: string): AIChatToolResultPart | undefined;
  getModel(): string | undefined;

  // Mutate (sync — safe to call from the streaming loop)
  appendMessages(messages: AIChatMessage[]): void;
  setStreaming(streaming: boolean): void;
  touchStreamedAt(): void;
  updateTitle(title: string): void;
  setModel(model: string | undefined): void;

  /** Point-in-time snapshot of buffer state for persistence. */
  snapshot(): ConversationBufferSnapshot;
}

// ---------------------------------------------------------------------------
// LocalConversationBuffer — in-process implementation
// ---------------------------------------------------------------------------

export class LocalConversationBuffer implements ConversationBuffer {
  private messages: AIChatMessage[];
  private isStreamingFlag: boolean;
  private lastStreamedAtMs: number;
  private lastAccessedAtMs: number;
  private titleValue: string;
  private modelValue: string | undefined;
  private readonly agentTypeValue: string;

  constructor(
    public readonly conversationId: string,
    init: {
      messages: AIChatMessage[];
      isStreaming: boolean;
      lastStreamedAt: number;
      title: string;
      agentType: string;
      model?: string;
    },
  ) {
    this.messages = init.messages;
    this.isStreamingFlag = init.isStreaming;
    this.lastStreamedAtMs = init.lastStreamedAt;
    this.lastAccessedAtMs = Date.now();
    this.titleValue = init.title;
    this.agentTypeValue = init.agentType;
    this.modelValue = init.model;
  }

  getMessages(): AIChatMessage[] {
    this.lastAccessedAtMs = Date.now();
    return this.messages;
  }

  getLatestToolResult(toolName: string): AIChatToolResultPart | undefined {
    const msgs = this.getMessages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.role !== "tool") continue;
      for (let j = m.content.length - 1; j >= 0; j--) {
        const part = m.content[j]!;
        if (part.toolName === toolName) return part;
      }
    }
    return undefined;
  }

  appendMessages(msgs: AIChatMessage[]): void {
    if (!msgs.length) return;
    this.messages = [...this.messages, ...msgs].slice(
      -MAX_MESSAGES_PER_CONVERSATION,
    );
  }

  setStreaming(streaming: boolean): void {
    this.isStreamingFlag = streaming;
    if (streaming) {
      this.lastStreamedAtMs = Date.now();
    }
  }

  touchStreamedAt(): void {
    this.lastStreamedAtMs = Date.now();
  }

  updateTitle(title: string): void {
    this.titleValue = title;
  }

  getModel(): string | undefined {
    return this.modelValue;
  }

  setModel(model: string | undefined): void {
    this.modelValue = model;
  }

  snapshot(): ConversationBufferSnapshot {
    return {
      messages: this.messages,
      title: this.titleValue,
      isStreaming: this.isStreamingFlag,
      lastStreamedAt: this.lastStreamedAtMs,
      lastAccessedAt: this.lastAccessedAtMs,
      model: this.modelValue,
      agentType: this.agentTypeValue,
    };
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConversationStatus {
  isStreaming: boolean;
  lastStreamedAt: number;
  messages: AIChatMessage[];
  feedback: AIChatFeedbackEntry[];
}

export interface ConversationSummary {
  conversationId: string;
  title: string;
  createdAt: number;
  messageCount: number;
  isStreaming: boolean;
  /** Truncated text of the first user message, for sidebar preview. */
  preview: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Async DB operations — called at request boundaries, not inside the stream.
// ---------------------------------------------------------------------------

/**
 * Loads or creates a conversation and returns a request-scoped buffer.
 *
 * - Exists in DB → returns a buffer seeded with persisted messages/metadata.
 * - Not in DB → creates a new document in MongoDB and returns an empty buffer.
 */
export async function loadOrInitConversation(
  model: AIConversationModel,
  conversationId: string,
  userId: string,
  agentType: string,
): Promise<ConversationBuffer> {
  const existing = await model.getById(conversationId);
  if (existing) {
    return new LocalConversationBuffer(conversationId, {
      messages: existing.messages as AIChatMessage[],
      isStreaming: existing.isStreaming,
      lastStreamedAt: existing.lastStreamedAt.getTime(),
      title: existing.title,
      agentType: existing.agentType,
      model: existing.model,
    });
  }

  await model.create({
    id: conversationId,
    userId,
    agentType,
    title: "New Chat",
    messages: [],
    isStreaming: false,
    lastStreamedAt: new Date(0),
    lastAccessedAt: new Date(),
    messageCount: 0,
    preview: "",
  });

  return new LocalConversationBuffer(conversationId, {
    messages: [],
    isStreaming: false,
    lastStreamedAt: 0,
    title: "New Chat",
    agentType,
  });
}

/**
 * Flushes the buffer's current state to MongoDB.
 *
 * Called twice per streaming request:
 *   - After the user message is appended (crash-safety: user turn is durable).
 *   - In the finally block after the stream closes (persists assistant/tool turns).
 *
 * Both call sites fire-and-forget (.catch'd), so this never blocks the
 * SSE response.
 */
export async function persistConversation(
  model: AIConversationModel,
  buffer: ConversationBuffer,
): Promise<void> {
  const {
    messages,
    title,
    isStreaming,
    lastStreamedAt,
    lastAccessedAt,
    model: conversationModel,
    agentType,
  } = buffer.snapshot();

  const firstUserMsg = messages.find((m) => m.role === "user");
  const preview =
    typeof firstUserMsg?.content === "string"
      ? firstUserMsg.content.slice(0, 200)
      : "";

  try {
    await model.updateById(buffer.conversationId, {
      messages,
      title,
      isStreaming,
      lastStreamedAt: new Date(lastStreamedAt),
      lastAccessedAt: new Date(lastAccessedAt),
      messageCount: messages.length,
      preview,
      model: conversationModel,
      agentType,
    });
  } catch (err) {
    logger.error(err, "Failed to persist conversation to DB");
  }
}

/**
 * Returns messages and streaming state for a conversation from MongoDB.
 * Returns null if the conversation does not exist.
 */
export async function getConversationStatus(
  model: AIConversationModel,
  conversationId: string,
): Promise<ConversationStatus | null> {
  const doc = await model.getById(conversationId);
  if (!doc) return null;

  return {
    isStreaming: doc.isStreaming,
    lastStreamedAt: doc.lastStreamedAt.getTime(),
    messages: doc.messages as AIChatMessage[],
    feedback: (doc.feedback ?? []) as AIChatFeedbackEntry[],
  };
}

/**
 * Returns all non-empty conversations for the authenticated user, sorted
 * newest-first. Reads from MongoDB using a projection that excludes the
 * messages array, so this is cheap regardless of conversation size.
 */
export async function listConversations(
  model: AIConversationModel,
  agentType?: string,
): Promise<ConversationSummary[]> {
  const docs = await model.listByUser(agentType);
  return docs
    .filter((doc) => doc.messageCount > 0)
    .map((doc) => ({
      conversationId: doc.id,
      title: doc.title,
      createdAt: doc.dateCreated.getTime(),
      messageCount: doc.messageCount,
      isStreaming: doc.isStreaming,
      preview: doc.preview,
      model: doc.model,
    }));
}
