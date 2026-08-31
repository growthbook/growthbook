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

export const aiChatMentionValidator = z
  .object({
    type: z.enum(["metric", "factMetric", "metricGroup", "dashboard"]),
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
  })
  .strict();

/** Both the `openAnalyticsChat` tool input and what the handoff card reads back. */
export const analyticsHandoffValidator = z.object({
  // Picks the skill the other chat opens with. Required, not defaulted: guessing
  // `create` for an edit is how the user ends up with a duplicate dashboard.
  mode: z
    .enum(["create", "edit"])
    .describe(
      "`create` to build a new dashboard, `edit` to change one that already " +
        "exists. On `edit`, name that dashboard in `mentions` so the other chat " +
        "resolves it by id instead of searching.",
    ),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      "The brief to start the Analytics chat with, written as the user would put it " +
        "and complete on its own — the chat on the other side gets this text and " +
        "nothing else from this conversation. Name the metrics, the timeframe, and " +
        "the dashboard name if the user gave one.",
    ),
  // A malformed `mentions` drops rather than failing the whole handoff.
  mentions: aiChatMentionValidator
    .array()
    .max(20)
    .optional()
    .catch(undefined)
    .describe(
      "Entities named in the prompt, copied from the `[Referenced by the user: ...]` " +
        "line, so the other chat resolves them by id instead of searching.",
    ),
});

export type AnalyticsHandoff = z.infer<typeof analyticsHandoffValidator>;

/** The `openAnalyticsChat` tool result, as the transcript stores it. */
export const analyticsHandoffResultValidator = z.object({
  handoff: analyticsHandoffValidator,
});

/** Stored form. `stale` is server-set — the client cannot assert it. */
export const aiChatStoredMentionValidator = aiChatMentionValidator.extend({
  stale: z.boolean().optional(),
});

export const aiChatSkillsValidator = z.array(z.string().min(1).max(64));

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
    currentPage: z.string().max(2048).optional(),
    datasourceHint: z.string().max(256).optional(),
    mentions: aiChatStoredMentionValidator.array().optional(),
    skills: aiChatSkillsValidator.optional(),
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
// Pending agent action (deterministic mutation-confirmation gate)
// ---------------------------------------------------------------------------

/**
 * A mutating REST API call the agent has requested but that the harness has
 * parked pending explicit user confirmation. Stored on the conversation so
 * the exact call can be replayed deterministically when the user confirms on
 * a later turn — the model is never relied upon to re-issue it.
 */
export const aiAgentPendingActionValidator = z.object({
  id: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  query: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  /** Short human-readable description shown in the confirmation prompt. */
  summary: z.string(),
  createdAt: z.number(),
});

export type AIAgentPendingAction = z.infer<
  typeof aiAgentPendingActionValidator
>;

// ---------------------------------------------------------------------------
// Saved dashboards
// ---------------------------------------------------------------------------

/**
 * A dashboard the user saved from a `proposeDashboard` preview, keyed by the
 * tool call that proposed it. Without this the binding lives only in component
 * state, so re-opening the conversation offers Save again and creates a second
 * dashboard from the same tile.
 */
export const aiChatSavedDashboardValidator = z
  .object({
    toolCallId: z.string().min(1).max(128),
    dashboardId: z.string().min(1).max(128),
  })
  .strict();

export type AIChatSavedDashboard = z.infer<
  typeof aiChatSavedDashboardValidator
>;

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
    /**
     * Set when the agent has requested a mutating API call and is waiting for
     * the user to confirm. Replayed deterministically by the harness on
     * confirm; `null`/absent means there is no pending action.
     */
    pendingAction: aiAgentPendingActionValidator.nullable().optional(),
    /** Dashboards saved from this conversation's previews, by tool call id. */
    savedDashboards: aiChatSavedDashboardValidator.array().optional(),
  })
  .strict();

export type AIConversationInterface = z.infer<typeof aiConversationValidator>;

export type AIConversationWithoutMessages = Omit<
  AIConversationInterface,
  "messages"
>;
