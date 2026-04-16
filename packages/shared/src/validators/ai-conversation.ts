import { z } from "zod";

// ---------------------------------------------------------------------------
// Content part validators (mirror AIChatMessage types in shared/ai-chat.ts)
// ---------------------------------------------------------------------------

// .passthrough() is used on all message and part validators so that any fields
// added to the AIChatMessage types in shared/ai-chat.ts are preserved on DB
// writes rather than silently stripped by Zod's default unknown-key behaviour.

const aiChatTextPartValidator = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();

const aiChatImagePartValidator = z
  .object({
    type: z.literal("image"),
    mediaType: z.string(),
    data: z.string(),
  })
  .passthrough();

const aiChatFilePartValidator = z
  .object({
    type: z.literal("file"),
    mediaType: z.string(),
    data: z.string(),
  })
  .passthrough();

const aiChatToolCallPartValidator = z
  .object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const aiChatToolResultPartValidator = z
  .object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.string(),
    isError: z.boolean().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Message validators (discriminated on role)
// ---------------------------------------------------------------------------

const aiChatSystemMessageValidator = z
  .object({
    role: z.literal("system"),
    id: z.string(),
    ts: z.number(),
    content: z.string(),
  })
  .passthrough();

const aiChatUserMessageValidator = z
  .object({
    role: z.literal("user"),
    id: z.string(),
    ts: z.number(),
    content: z.union([
      z.string(),
      z.array(
        z.union([
          aiChatTextPartValidator,
          aiChatImagePartValidator,
          aiChatFilePartValidator,
        ]),
      ),
    ]),
  })
  .passthrough();

const aiChatAssistantMessageValidator = z
  .object({
    role: z.literal("assistant"),
    id: z.string(),
    ts: z.number(),
    content: z.union([
      z.string(),
      z.array(
        z.union([
          aiChatTextPartValidator,
          aiChatImagePartValidator,
          aiChatFilePartValidator,
          aiChatToolCallPartValidator,
        ]),
      ),
    ]),
    isError: z.boolean().optional(),
  })
  .passthrough();

const aiChatToolMessageValidator = z
  .object({
    role: z.literal("tool"),
    id: z.string(),
    ts: z.number(),
    content: z.array(aiChatToolResultPartValidator),
  })
  .passthrough();

export const aiChatMessageValidator = z.discriminatedUnion("role", [
  aiChatSystemMessageValidator,
  aiChatUserMessageValidator,
  aiChatAssistantMessageValidator,
  aiChatToolMessageValidator,
]);

export type PersistedAIChatMessage = z.infer<typeof aiChatMessageValidator>;

// ---------------------------------------------------------------------------
// Feedback validator
// ---------------------------------------------------------------------------

export const aiChatFeedbackRatingValidator = z.enum(["positive", "negative"]);

export type AIChatFeedbackRating = z.infer<
  typeof aiChatFeedbackRatingValidator
>;

export const aiChatFeedbackEntryValidator = z.object({
  messageId: z.string(),
  rating: aiChatFeedbackRatingValidator,
  comment: z.string(),
  userId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AIChatFeedbackEntry = z.infer<typeof aiChatFeedbackEntryValidator>;

// ---------------------------------------------------------------------------
// Conversation document validator
// ---------------------------------------------------------------------------

export const aiConversationValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    userId: z.string(),
    /** Discriminator so each agent only loads its own conversations. */
    agentType: z.string(),
    title: z.string(),
    messages: z.array(aiChatMessageValidator),
    isStreaming: z.boolean(),
    lastStreamedAt: z.date(),
    lastAccessedAt: z.date(),
    /** Cached count of messages — updated on persist to avoid loading full messages for list views. */
    messageCount: z.number(),
    /** Truncated text of the first user message — updated on persist for sidebar preview. */
    preview: z.string(),
    model: z.string().optional(),
    feedback: z.array(aiChatFeedbackEntryValidator).optional(),
  })
  .strict();

export type AIConversationInterface = z.infer<typeof aiConversationValidator>;

export type AIConversationWithoutMessages = Omit<
  AIConversationInterface,
  "messages"
>;
