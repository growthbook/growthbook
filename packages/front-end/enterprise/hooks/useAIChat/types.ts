// ---------------------------------------------------------------------------
// Public types for useAIChat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: "text" | "tool-call";
  toolLabel?: string;
  /** Preserved from the tool-status item so consumers can correlate
   *  finalized tool-call messages with domain-specific data (e.g. charts). */
  toolCallId?: string;
}

export type ActiveTurnItem =
  | { kind: "text"; id: string; content: string }
  | {
      kind: "tool-status";
      id: string;
      toolCallId: string;
      label: string;
      status: "running" | "done";
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
   * status). Required when `conversationStorageKey` is set to enable reconnect.
   */
  getConversationEndpoint?: (conversationId: string) => string;

  /**
   * Called with the full raw ModelMessage array whenever a conversation is
   * loaded from the server (on mount reconnect or explicit loadConversation).
   * Use this to reconstruct domain-specific artifact state (e.g. chart data)
   * from stored tool results that are not captured by the hydrated ChatMessages.
   */
  onRawMessages?: (messages: unknown[]) => void;
}

export interface ConversationSummary {
  conversationId: string;
  title: string;
  createdAt: number;
  messageCount: number;
  isStreaming: boolean;
}

export interface UseAIChatReturn {
  messages: ChatMessage[];
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
