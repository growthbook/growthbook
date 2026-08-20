/**
 * Persisted AI chat messages: content parts shaped like the AI SDK’s model messages,
 * plus id/ts for storage and UI. Convert to ModelMessage[] via toModelMessages (back-end).
 */

// ---------------------------------------------------------------------------
// Roles & content parts (mirror @ai-sdk/provider-utils names where possible)
// ---------------------------------------------------------------------------

export type AIChatMessageRole = "system" | "user" | "assistant" | "tool";

export type AIChatTextPart = { type: "text"; text: string };

/** Serialized image (base64 or URL string); maps to UserModelMessage ImagePart.image. */
export type AIChatImagePart = {
  type: "image";
  mediaType: string;
  data: string;
};

export type AIChatFilePart = {
  type: "file";
  mediaType: string;
  data: string;
};

export type AIChatToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  /** Matches ModelMessage tool-call `input` after conversion. */
  args: Record<string, unknown>;
};

export type AIChatToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  /**
   * Tool output as text for the model — typically `JSON.stringify` of the executed tool return value.
   * Consumers that need objects should `JSON.parse` (see {@link tryParseToolResultJson}).
   */
  result: string;
  isError?: boolean;
};

export type AIChatUserContentPart =
  | AIChatTextPart
  | AIChatImagePart
  | AIChatFilePart;

export type AIChatAssistantContentPart =
  | AIChatTextPart
  | AIChatImagePart
  | AIChatFilePart
  | AIChatToolCallPart;

export type AIChatToolMessageContentPart = AIChatToolResultPart;

/**
 * Unwraps AI SDK stream shape `{ type: "text", value: "<json-or-text>" }` to a plain value
 * before stringifying for storage.
 */
function unwrapStreamedToolOutput(output: unknown): unknown {
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    "type" in output &&
    (output as { type: string }).type === "text" &&
    "value" in output &&
    typeof (output as { value: unknown }).value === "string"
  ) {
    const raw = (output as { value: string }).value;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // use raw string
    }
    return raw;
  }
  return output;
}

/** Canonical string form persisted on {@link AIChatToolResultPart.result}. */
export function stringifyToolResultForStorage(output: unknown): string {
  const value = unwrapStreamedToolOutput(output);
  if (value === undefined) {
    return "null";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

export function tryParseToolResultJson(resultJson: string): unknown {
  try {
    return JSON.parse(resultJson) as unknown;
  } catch {
    return undefined;
  }
}

/** Snapshot id inside a JSON tool result (e.g. product analytics), if any. */
export function toolResultSnapshotId(resultJson: string): string | undefined {
  const value = tryParseToolResultJson(resultJson);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).snapshotId;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * Short label for chat UI when no tool-specific status label is configured.
 */
export function toolResultPreviewLabel(
  resultJson: string,
  fallback: string,
): string {
  const value = tryParseToolResultJson(resultJson);
  if (value === undefined) {
    const t = resultJson.trim();
    if (!t) return fallback;
    return t.length > 120 ? `${t.slice(0, 117)}...` : t;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return fallback;
    return t.length > 120 ? `${t.slice(0, 117)}...` : t;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o.summary === "string" && o.summary.trim()) {
      return o.summary;
    }
    if (typeof o.message === "string" && o.message.trim()) {
      return o.message;
    }
  }
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type AIChatSystemMessage = {
  role: "system";
  id: string;
  ts: number;
  content: string;
};

/** Kinds of entity a user can @-mention in the chat composer. */
export type AIChatMentionType = "metric" | "factMetric" | "metricGroup";

/**
 * An entity the user @-mentioned. The composer writes the readable form
 * ("@Revenue") into the message text and sends the resolved id alongside it, so
 * the agent never has to guess which metric a name refers to.
 */
export type AIChatMention = {
  type: AIChatMentionType;
  id: string;
  name: string;
  /**
   * The entity doesn't belong to the Data Source this turn runs against (or no
   * longer exists). Set by the server at send time, never accepted from the
   * client, and persisted so the transcript keeps what was true when the
   * message was sent. The reference is still passed to the model, which is told
   * to say so rather than act on it — see `toModelMessages`.
   */
  stale?: boolean;
};

/** Domain routers are the browsable entry points; leaves sit under them. */
export type SkillKind = "domain" | "leaf";

/**
 * One agent skill as the `/agent/skills` index describes it — the wire shape
 * behind the composer's `/` command menu.
 *
 * Deliberately omits the skill's `body`: those are large prompt payloads the UI
 * has no use for, and the agent loads them itself.
 */
export interface SkillSummary {
  name: string;
  description: string;
  kind: SkillKind;
  /** Parent domain name for leaf skills; equals `name` for domain routers. */
  group?: string;
}

export type AIChatUserMessage = {
  role: "user";
  id: string;
  ts: number;
  content: string | AIChatUserContentPart[];
  /**
   * Entities the user @-mentioned in this message. Persisted so the reference
   * survives a reload, and injected by `toModelMessages` as a
   * `[Referenced metrics: …]` prefix carrying the ids.
   */
  mentions?: AIChatMention[];
  /**
   * Skills invoked via `/` commands, in the order they appear in the message.
   * The agent receives each as a pre-loaded `loadSkill` result rather than from
   * here — these are persisted so the chat log can render the commands the
   * message was sent with.
   */
  skills?: string[];
  /**
   * URL path (+ search) the user was on when they sent this message.
   * Captured at send time and persisted on the message so per-turn page
   * context is preserved across navigation. Not displayed in the chat UI;
   * `toModelMessages` injects it as a `[Page context: …]` prefix into the
   * model-bound message so the agent can interpret references like "this
   * experiment". Skills document the URL → entity mapping.
   */
  currentPage?: string;
  /**
   * Optional product-analytics datasource the client had selected when this
   * message was sent (e.g. the explorer's last-used datasource). Kept off the
   * static system prompt so the prompt stays cacheable; instead persisted on
   * the message and injected by `toModelMessages` as an
   * `[Active product-analytics datasource: …]` prefix. It is a soft hint — the
   * agent may still search other datasources or ask the user to switch.
   */
  datasourceHint?: string;
};

export type AIChatAssistantMessage = {
  role: "assistant";
  id: string;
  ts: number;
  content: string | AIChatAssistantContentPart[];
  /** When true the message represents a stream-level error (e.g. provider
   *  failure or circuit breaker) rather than normal assistant text. */
  isError?: boolean;
};

export type AIChatToolMessage = {
  role: "tool";
  id: string;
  ts: number;
  content: AIChatToolMessageContentPart[];
};

export type AIChatMessage =
  | AIChatSystemMessage
  | AIChatUserMessage
  | AIChatAssistantMessage
  | AIChatToolMessage;

/** Extracts the concatenated text content from any message with text parts. */
export function getMessageText(
  msg: AIChatUserMessage | AIChatAssistantMessage,
): string {
  if (typeof msg.content === "string") return msg.content;
  return (msg.content as (AIChatTextPart | { type: string })[])
    .filter((p): p is AIChatTextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
