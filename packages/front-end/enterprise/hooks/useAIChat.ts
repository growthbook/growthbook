import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/services/auth";

// ---------------------------------------------------------------------------
// Types
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

// ---------------------------------------------------------------------------
// Typewriter constants
// ---------------------------------------------------------------------------

const TYPEWRITER_INTERVAL_MS = 30;
const TYPEWRITER_CHARS_PER_TICK = 3;

// ---------------------------------------------------------------------------
// SSE parse utility
// ---------------------------------------------------------------------------

export function parseSSEEvents(buffer: string): {
  parsed: SSEEvent[];
  remaining: string;
} {
  const parsed: SSEEvent[] = [];
  const blocks = buffer.split("\n\n");
  const remaining = blocks.pop() ?? "";

  for (const block of blocks) {
    const lines = block.split("\n");
    let eventType = "message";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice("event: ".length).trim();
      } else if (line.startsWith("data: ")) {
        dataStr = line.slice("data: ".length).trim();
      }
    }

    if (dataStr) {
      try {
        const data = JSON.parse(dataStr) as Record<string, unknown>;
        parsed.push({ type: eventType, data });
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  return { parsed, remaining };
}

// ---------------------------------------------------------------------------
// Hook options and return type
// ---------------------------------------------------------------------------

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
}

export interface UseAIChatReturn {
  messages: ChatMessage[];
  activeTurnItems: ActiveTurnItem[];
  displayedTextMap: Map<string, string>;
  sendMessage: () => void;
  newChat: () => void;
  loading: boolean;
  waitingForNextStep: boolean;
  error: string | null;
  input: string;
  setInput: (value: string) => void;
  conversationId: string;
}

// ---------------------------------------------------------------------------
// useAIChat
// ---------------------------------------------------------------------------

export function useAIChat({
  endpoint,
  buildRequestBody,
  toolStatusLabels = {},
  onSSEEvent,
  conversationStorageKey,
  getConversationEndpoint,
}: UseAIChatOptions): UseAIChatReturn {
  const messageCounterRef = useRef(0);

  const [conversationId, setConversationId] = useState<string>(() => {
    if (conversationStorageKey) {
      const stored = sessionStorage.getItem(conversationStorageKey);
      if (stored) return stored;
    }
    const newId = crypto.randomUUID();
    if (conversationStorageKey) {
      sessionStorage.setItem(conversationStorageKey, newId);
    }
    return newId;
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTurnItems, setActiveTurnItems] = useState<ActiveTurnItem[]>([]);
  const activeTurnItemsRef = useRef<ActiveTurnItem[]>([]);

  const [displayedTextMap, setDisplayedTextMap] = useState<Map<string, string>>(
    new Map(),
  );
  const displayedTextMapRef = useRef<Map<string, string>>(new Map());

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitingForNextStep, setWaitingForNextStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { fetchRaw, apiCall } = useAuth();

  // ---------------------------------------------------------------------------
  // Active items state helper
  // ---------------------------------------------------------------------------

  const setActive = useCallback((items: ActiveTurnItem[]) => {
    if (items.length === 0) {
      displayedTextMapRef.current = new Map();
      setDisplayedTextMap(new Map());
    }
    activeTurnItemsRef.current = items;
    setActiveTurnItems(items);
  }, []);

  // ---------------------------------------------------------------------------
  // Typewriter effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const interval = setInterval(() => {
      const items = activeTurnItemsRef.current;
      const current = displayedTextMapRef.current;
      let changed = false;

      const next = new Map(current);
      for (const item of items) {
        if (item.kind !== "text") continue;
        const revealed = current.get(item.id) ?? "";
        if (revealed.length < item.content.length) {
          changed = true;
          const nextLen = Math.min(
            revealed.length + TYPEWRITER_CHARS_PER_TICK,
            item.content.length,
          );
          next.set(item.id, item.content.slice(0, nextLen));
        }
      }

      if (changed) {
        displayedTextMapRef.current = next;
        setDisplayedTextMap(new Map(next));
      }
    }, TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------------------------
  // Reconnect: on mount, check for active/recent conversations
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!conversationStorageKey || !getConversationEndpoint) return;

    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const checkStatus = async () => {
      try {
        const data = await apiCall<{
          isStreaming: boolean;
          lastStreamedAt: number;
          messages: unknown[];
        }>(getConversationEndpoint(conversationId));

        if (cancelled) return;

        const STALE_THRESHOLD_MS = 60_000;
        const isRecent =
          data.lastStreamedAt > 0 &&
          Date.now() - data.lastStreamedAt < STALE_THRESHOLD_MS;

        if (data.messages.length > 0) {
          const hydrated: ChatMessage[] = (
            data.messages as Array<{ role: string; content: unknown }>
          )
            .filter(
              (m) =>
                (m.role === "user" || m.role === "assistant") &&
                typeof m.content === "string",
            )
            .map((m) => ({
              id: `msg_${messageCounterRef.current++}`,
              role: m.role as "user" | "assistant",
              kind: "text" as const,
              content: m.content as string,
            }));
          if (hydrated.length > 0) {
            setMessages(hydrated);
          }
        }

        if (data.isStreaming && isRecent) {
          setLoading(true);
          pollInterval = setInterval(async () => {
            if (cancelled) {
              if (pollInterval) clearInterval(pollInterval);
              return;
            }
            try {
              const poll = await apiCall<{
                isStreaming: boolean;
                messages: unknown[];
              }>(getConversationEndpoint(conversationId));
              if (cancelled) return;
              if (!poll.isStreaming) {
                if (pollInterval) clearInterval(pollInterval);
                setLoading(false);
                const finalHydrated: ChatMessage[] = (
                  poll.messages as Array<{ role: string; content: unknown }>
                )
                  .filter(
                    (m) =>
                      (m.role === "user" || m.role === "assistant") &&
                      typeof m.content === "string",
                  )
                  .map((m) => ({
                    id: `msg_${messageCounterRef.current++}`,
                    role: m.role as "user" | "assistant",
                    kind: "text" as const,
                    content: m.content as string,
                  }));
                if (finalHydrated.length > 0) {
                  setMessages(finalHydrated);
                }
              }
            } catch {
              if (pollInterval) clearInterval(pollInterval);
              setLoading(false);
            }
          }, 2500);
        } else if (data.isStreaming && !isRecent) {
          setError("Generation was interrupted. You can send a new message.");
        }
      } catch {
        // Status check failed — silently ignore and start fresh
      }
    };

    checkStatus();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // finalizeTurn: convert active items to persisted ChatMessages
  // ---------------------------------------------------------------------------

  const finalizeTurn = useCallback(() => {
    const items = activeTurnItemsRef.current;
    if (!items.length) return;

    const newMessages: ChatMessage[] = [];
    for (const item of items) {
      if (item.kind === "thinking") {
        continue;
      } else if (item.kind === "text" && item.content.trim()) {
        newMessages.push({
          id: `msg_${messageCounterRef.current++}`,
          role: "assistant",
          kind: "text",
          content: item.content,
        });
      } else if (item.kind === "tool-status") {
        newMessages.push({
          id: `msg_${messageCounterRef.current++}`,
          role: "assistant",
          kind: "tool-call",
          content: "",
          toolLabel: item.label,
          toolCallId: item.toolCallId,
        });
      }
    }

    if (newMessages.length) {
      setMessages((prev) => [...prev, ...newMessages]);
    }
    setActive([]);
  }, [setActive]);

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      id: `msg_${messageCounterRef.current++}`,
      role: "user",
      content: trimmed,
      kind: "text",
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setError(null);
    setLoading(true);
    setActive([]);
    setWaitingForNextStep(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetchRaw(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "x-no-compression": "1" },
        body: JSON.stringify(buildRequestBody(trimmed, conversationId)),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        if (response.status === 429 && errorData?.retryAfter) {
          const retryAfter = parseInt(errorData.retryAfter);
          const hours = Math.floor(retryAfter / 3600);
          const minutes = Math.floor((retryAfter % 3600) / 60);
          setError(
            `AI request limit reached. Try again in ${hours}h ${minutes}m.`,
          );
        } else {
          setError(errorData?.message || `Error: ${response.status}`);
        }
        setLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError("Streaming not supported");
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { parsed, remaining } = parseSSEEvents(buffer);
        buffer = remaining;

        for (const event of parsed) {
          onSSEEvent?.(event);

          const current = activeTurnItemsRef.current;

          switch (event.type) {
            case "reasoning-delta": {
              setWaitingForNextStep(false);
              const last = current[current.length - 1];
              if (last?.kind !== "thinking") {
                setActive([
                  ...current,
                  {
                    kind: "thinking",
                    id: `thinking_${messageCounterRef.current++}`,
                  },
                ]);
              }
              break;
            }
            case "text-delta": {
              const content = event.data.content;
              if (typeof content === "string") {
                setWaitingForNextStep(false);
                const withoutThinking =
                  current[current.length - 1]?.kind === "thinking"
                    ? current.slice(0, -1)
                    : current;
                const last = withoutThinking[withoutThinking.length - 1];
                if (last?.kind === "text") {
                  setActive([
                    ...withoutThinking.slice(0, -1),
                    { ...last, content: last.content + content },
                  ]);
                } else {
                  setActive([
                    ...withoutThinking,
                    {
                      kind: "text",
                      id: `text_${messageCounterRef.current++}`,
                      content,
                    },
                  ]);
                }
              }
              break;
            }
            case "tool-call-start": {
              const toolName =
                typeof event.data.toolName === "string"
                  ? event.data.toolName
                  : "";
              const toolCallId =
                typeof event.data.toolCallId === "string"
                  ? event.data.toolCallId
                  : `tool_${messageCounterRef.current++}`;
              const label = toolStatusLabels[toolName] ?? "Working...";
              setWaitingForNextStep(false);
              setActive([
                ...current,
                {
                  kind: "tool-status",
                  id: toolCallId,
                  toolCallId,
                  label,
                  status: "running",
                },
              ]);
              break;
            }
            case "tool-call-end": {
              const toolCallId =
                typeof event.data.toolCallId === "string"
                  ? event.data.toolCallId
                  : "";
              setWaitingForNextStep(true);
              setActive(
                current.map((item) =>
                  item.kind === "tool-status" && item.toolCallId === toolCallId
                    ? { ...item, status: "done" as const }
                    : item,
                ),
              );
              break;
            }
            case "error": {
              const msg = event.data.message;
              setError(typeof msg === "string" ? msg : "An error occurred");
              break;
            }
            case "done": {
              setWaitingForNextStep(false);
              finalizeTurn();
              break;
            }
            default:
              break;
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled — ignore
      } else {
        setError("Failed to get a response. Please try again.");
      }
    } finally {
      finalizeTurn();
      setWaitingForNextStep(false);
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [
    input,
    loading,
    fetchRaw,
    endpoint,
    buildRequestBody,
    conversationId,
    toolStatusLabels,
    onSSEEvent,
    setActive,
    finalizeTurn,
  ]);

  // ---------------------------------------------------------------------------
  // newChat
  // ---------------------------------------------------------------------------

  const newChat = useCallback(() => {
    abortControllerRef.current?.abort();
    const newId = crypto.randomUUID();
    if (conversationStorageKey) {
      sessionStorage.setItem(conversationStorageKey, newId);
    }
    setConversationId(newId);
    setMessages([]);
    setActive([]);
    setError(null);
    setLoading(false);
    setWaitingForNextStep(false);
  }, [conversationStorageKey, setActive]);

  return {
    messages,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    newChat,
    loading,
    waitingForNextStep,
    error,
    input,
    setInput,
    conversationId,
  };
}
