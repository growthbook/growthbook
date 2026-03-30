// ---------------------------------------------------------------------------
// Public types for useAIChat
// ---------------------------------------------------------------------------

import type { RichMessage } from "shared";

export type { RichMessage };

export type ActiveTurnItem =
  | { kind: "text"; id: string; content: string }
  | {
      kind: "tool-status";
      id: string;
      toolCallId: string;
      toolName: string;
      label: string;
      status: "running" | "done" | "error";
      /** Parsed tool arguments from tool-call-input SSE. */
      toolInput?: Record<string, unknown>;
      /** Raw argument stream before JSON is complete (tool-call-args-delta). */
      argsTextPreview?: string;
      /** Serialized tool return value from tool-call-end SSE. */
      toolOutput?: unknown;
      errorMessage?: string;
      /** Populated from chart-result SSE for runExploration. */
      toolResultData?: Record<string, unknown>;
    }
  | { kind: "thinking"; id: string };

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface UseAIChatOptions {
  endpoint: string;

  buildRequestBody: (
    message: string,
    conversationId: string,
  ) => Record<string, unknown>;

  /** Maps backend tool names to user-facing labels for the status pill */
  toolStatusLabels?: Record<string, string>;

  /**
   * Called for every parsed SSE event. Use this to react to domain-specific
   * events (e.g. "chart-result") and manage your own artifact state.
   */
  onSSEEvent?: (event: SSEEvent) => void;

  /**
   * If provided, the conversation ID is persisted to sessionStorage under this
   * key so it survives same-tab SPA navigation. On component mount the hook
   * also calls `getConversationEndpoint(conversationId)` to check for active
   * streams.
   */
  conversationStorageKey?: string;

  /**
   * Returns the URL for loading an existing conversation (messages + streaming
   * status). When set, the hook refetches whenever `conversationId` changes
   * and polls while the server reports `isStreaming` (e.g. after refresh or
   * opening a chat from the sidebar). Pair with `conversationStorageKey` to
   * restore the last-open conversation on load.
   */
  getConversationEndpoint?: (conversationId: string) => string;

  /**
   * Called once the POST to `endpoint` returns a successful response (before
   * the response body is read). Use to refresh conversation lists after the
   * server has persisted the user message.
   */
  onStreamAccepted?: () => void;
}

export interface ConversationSummary {
  conversationId: string;
  title: string;
  createdAt: number;
  messageCount: number;
  isStreaming: boolean;
}

/** GET /chat/:id — messages plus whether the agent is still generating. */
export interface ConversationLoadResponse {
  messages: RichMessage[];
  isStreaming: boolean;
  lastStreamedAt: number;
}

export interface UseAIChatReturn {
  messages: RichMessage[];
  activeTurnItems: ActiveTurnItem[];
  displayedTextMap: Map<string, string>;
  sendMessage: () => void;
  newChat: () => void;
  loadConversation: (id: string) => Promise<void>;
  loading: boolean;
  waitingForNextStep: boolean;
  error: string | null;
  input: string;
  setInput: (value: string) => void;
  conversationId: string;
}
