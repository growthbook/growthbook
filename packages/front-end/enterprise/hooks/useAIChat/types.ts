// ---------------------------------------------------------------------------
// Public types for useAIChat
// ---------------------------------------------------------------------------

import type { AIChatMessage } from "shared/ai-chat";

export type { AIChatMessage };

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
      /** Chart payload derived from runExploration tool output on tool-call-end. */
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
   * events and manage your own artifact state.
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
   * Returns the URL for cancelling an active stream on the server.
   * When set, the Cancel button sends a POST here before aborting the local
   * fetch — this lets the backend distinguish explicit cancels from navigation
   * disconnects and continue generating in the background for the latter.
   */
  getCancelEndpoint?: (conversationId: string) => string;

  /**
   * Called once the POST to `endpoint` returns a successful response (before
   * the response body is read). Use to refresh conversation lists after the
   * server has persisted the user message.
   */
  onStreamAccepted?: () => void;

  /**
   * Called after a conversation is loaded from the server (initial load or
   * poll). Receives the raw response so consumers can extract extra fields
   * (e.g. feedback) without changing the hook's core state.
   */
  onConversationLoaded?: (data: unknown) => void;

  /**
   * Called when the AI response stream completes successfully.
   * `durationMs` is the wall-clock time from send to stream end.
   * `toolCallCount` is the number of tool calls the agent made during this turn.
   */
  onMessageComplete?: (info: {
    durationMs: number;
    toolCallCount: number;
  }) => void;

  /**
   * Called when the user explicitly cancels generation.
   * `durationMs` is the wall-clock time from send to cancel.
   */
  onMessageCancelled?: (info: { durationMs: number }) => void;

  /** Called when a non-abort error occurs during message send or streaming. */
  onMessageError?: (info: { errorType: string; httpStatus?: number }) => void;
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

/** GET /chat/:id — messages plus whether the agent is still generating. */
export interface ConversationLoadResponse {
  messages: AIChatMessage[];
  isStreaming: boolean;
  lastStreamedAt: number;
}

export interface UseAIChatReturn {
  messages: AIChatMessage[];
  activeTurnItems: ActiveTurnItem[];
  displayedTextMap: Map<string, string>;
  sendMessage: (messageOverride?: string) => void;
  /** Cancels the active live stream. No-op unless `isLocalStream` is true. */
  cancelGeneration: () => void;
  newChat: () => void;
  loadConversation: (id: string) => Promise<void>;
  loading: boolean;
  /** True only while fetching historical messages for a conversation (not AI generation). */
  isLoadingConversation: boolean;
  /** True only while this tab is actively reading an SSE stream from sendMessage. */
  isLocalStream: boolean;
  waitingForNextStep: boolean;
  /** True when following a stream via polling (navigated away and back) rather
   *  than a live SSE connection on this tab. */
  isRemoteStream: boolean;
  error: string | null;
  input: string;
  setInput: (value: string) => void;
  conversationId: string;
}
