import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/services/auth";
import type {
  ActiveTurnItem,
  ChatMessage,
  UseAIChatOptions,
  UseAIChatReturn,
} from "./types";
import { parseSSEEvents } from "./parseSSE";
import { processSSEEvent } from "./processSSEEvent";
import { useTypewriter } from "./useTypewriter";
import { useReconnect } from "./useReconnect";
import { hydrateMessages } from "./utils";

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
  onRawMessages,
}: UseAIChatOptions): UseAIChatReturn {
  const messageCounterRef = useRef(0);
  const nextId = useCallback(() => messageCounterRef.current++, []);

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

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitingForNextStep, setWaitingForNextStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { fetchRaw, apiCall } = useAuth();

  // ---------------------------------------------------------------------------
  // Active items state helper
  // ---------------------------------------------------------------------------

  const { displayedTextMap, clearDisplayedText } = useTypewriter(
    activeTurnItemsRef,
  );

  const setActive = useCallback(
    (items: ActiveTurnItem[]) => {
      if (items.length === 0) clearDisplayedText();
      activeTurnItemsRef.current = items;
      setActiveTurnItems(items);
    },
    [clearDisplayedText],
  );

  // ---------------------------------------------------------------------------
  // Reconnect: on mount, check for active/recent conversations
  // ---------------------------------------------------------------------------

  useReconnect({
    conversationId,
    conversationStorageKey,
    getConversationEndpoint,
    apiCall,
    messageCounterRef,
    toolStatusLabels,
    setMessages,
    setLoading,
    setError,
    onRawMessages,
  });

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

          const result = processSSEEvent(
            event,
            activeTurnItemsRef.current,
            toolStatusLabels,
            nextId,
          );
          if (result.activeTurnItems) setActive(result.activeTurnItems);
          if (result.waitingForNextStep !== undefined)
            setWaitingForNextStep(result.waitingForNextStep);
          if (result.error) setError(result.error);
          if (result.done) finalizeTurn();
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
    nextId,
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

  // ---------------------------------------------------------------------------
  // loadConversation: switch to an existing conversation by ID
  // ---------------------------------------------------------------------------

  const loadConversation = useCallback(
    async (id: string) => {
      abortControllerRef.current?.abort();
      if (conversationStorageKey) {
        sessionStorage.setItem(conversationStorageKey, id);
      }
      setConversationId(id);
      setMessages([]);
      setActive([]);
      setError(null);
      setWaitingForNextStep(false);
      setLoading(true);

      if (getConversationEndpoint) {
        try {
          const data = await apiCall<{ messages: unknown[] }>(
            getConversationEndpoint(id),
          );
          onRawMessages?.(data.messages);
          const hydrated = hydrateMessages(
            data.messages,
            messageCounterRef,
            toolStatusLabels,
          );
          if (hydrated.length > 0) setMessages(hydrated);
        } catch {
          setError("Failed to load conversation.");
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    },
    [
      conversationStorageKey,
      getConversationEndpoint,
      apiCall,
      setActive,
      toolStatusLabels,
      onRawMessages,
    ],
  );

  return {
    messages,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    newChat,
    loadConversation,
    loading,
    waitingForNextStep,
    error,
    input,
    setInput,
    conversationId,
  };
}
