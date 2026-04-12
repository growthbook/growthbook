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

export type AIChatUserMessage = {
  role: "user";
  id: string;
  ts: number;
  content: string | AIChatUserContentPart[];
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
