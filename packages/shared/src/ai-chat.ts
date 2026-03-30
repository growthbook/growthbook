/**
 * Rich chat messages: single source of truth for persisted conversation state.
 * Domain-specific payloads live under tool-result.data, keyed by toolName at render time.
 *
 * Live SSE events (agent stream) include tool-call-start, tool-call-args-delta,
 * tool-call-input (parsed args), tool-call-end (output + optional preliminary),
 * tool-call-error, plus domain events such as chart-result.
 */

export type RichMessageUserText = {
  kind: "user-text";
  id: string;
  content: string;
  ts: number;
};

export type RichMessageAssistantText = {
  kind: "assistant-text";
  id: string;
  content: string;
  ts: number;
};

export type RichMessageToolCall = {
  kind: "tool-call";
  id: string;
  toolName: string;
  toolCallId: string;
  /** Tool arguments as returned by the model (optional when unknown). */
  args?: Record<string, unknown>;
  ts: number;
};

export type RichMessageToolResult = {
  kind: "tool-result";
  id: string;
  toolName: string;
  toolCallId: string;
  summary: string;
  data: Record<string, unknown>;
  ts: number;
};

export type RichMessage =
  | RichMessageUserText
  | RichMessageAssistantText
  | RichMessageToolCall
  | RichMessageToolResult;

/** GET /chat/:conversationId response body (messages slice). */
export interface AIChatConversationStatus {
  status: 200;
  isStreaming: boolean;
  lastStreamedAt: number;
  messages: RichMessage[];
}
