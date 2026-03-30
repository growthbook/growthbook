import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/services/auth";
import type {
  ActiveTurnItem,
  ConversationLoadResponse,
  RichMessage,
  UseAIChatOptions,
  UseAIChatReturn,
} from "./types";
import {
  REMOTE_STREAM_POLL_INTERVAL_MS,
  REMOTE_STREAM_STALE_MS,
} from "./remoteStreamConstants";
import { parseSSEEvents } from "./parseSSE";
import { processSSEEvent } from "./processSSEEvent";
import { useTypewriter } from "./useTypewriter";

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
  onStreamAccepted,
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

  const [messages, setMessages] = useState<RichMessage[]>([]);
  const [activeTurnItems, setActiveTurnItems] = useState<ActiveTurnItem[]>([]);
  const activeTurnItemsRef = useRef<ActiveTurnItem[]>([]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitingForNextStep, setWaitingForNextStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const remotePollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  /** Conversation id the active remote poll is for; stale callbacks must not apply. */
  const remotePollTargetIdRef = useRef<string | null>(null);
  const getConversationEndpointRef = useRef(getConversationEndpoint);
  getConversationEndpointRef.current = getConversationEndpoint;

  const { fetchRaw, apiCall } = useAuth();

  const clearRemotePoll = useCallback(() => {
    if (remotePollIntervalRef.current !== null) {
      clearInterval(remotePollIntervalRef.current);
      remotePollIntervalRef.current = null;
    }
    remotePollTargetIdRef.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // Active items state helper
  // ---------------------------------------------------------------------------

  const { displayedTextMap, clearDisplayedText } =
    useTypewriter(activeTurnItemsRef);

  const setActive = useCallback(
    (items: ActiveTurnItem[]) => {
      if (items.length === 0) clearDisplayedText();
      activeTurnItemsRef.current = items;
      setActiveTurnItems(items);
    },
    [clearDisplayedText],
  );

  // ---------------------------------------------------------------------------
  // Load conversation from server when id changes; poll while remote stream runs
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const getEp = getConversationEndpointRef.current;
    if (!getEp) return;

    let cancelled = false;

    const run = async () => {
      try {
        const data = await apiCall<ConversationLoadResponse>(
          getEp(conversationId),
        );
        if (cancelled) return;

        setMessages(data.messages ?? []);

        const isRecent =
          data.lastStreamedAt > 0 &&
          Date.now() - data.lastStreamedAt < REMOTE_STREAM_STALE_MS;

        if (data.isStreaming && isRecent) {
          setLoading(true);
          const targetId = conversationId;
          remotePollTargetIdRef.current = targetId;
          remotePollIntervalRef.current = setInterval(async () => {
            try {
              const poll = await apiCall<ConversationLoadResponse>(
                getEp(targetId),
              );
              if (cancelled || remotePollTargetIdRef.current !== targetId)
                return;
              setMessages(poll.messages ?? []);
              if (!poll.isStreaming) {
                clearRemotePoll();
                setLoading(false);
              }
            } catch {
              if (!cancelled && remotePollTargetIdRef.current === targetId) {
                clearRemotePoll();
                setLoading(false);
              }
            }
          }, REMOTE_STREAM_POLL_INTERVAL_MS);
        } else if (data.isStreaming && !isRecent) {
          setError("Generation was interrupted. You can send a new message.");
          setLoading(false);
        } else {
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load conversation.");
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      clearRemotePoll();
    };
  }, [apiCall, clearRemotePoll, conversationId]);

  // ---------------------------------------------------------------------------
  // finalizeTurn: convert active items to persisted RichMessages (fallback)
  // ---------------------------------------------------------------------------

  const finalizeTurn = useCallback(() => {
    const items = activeTurnItemsRef.current;
    if (!items.length) return;

    const toolOutputToData = (output: unknown): Record<string, unknown> => {
      if (output && typeof output === "object" && !Array.isArray(output)) {
        return { ...(output as Record<string, unknown>) };
      }
      return { value: output as unknown };
    };

    const summaryFromOutput = (output: unknown, fallback: string): string => {
      if (typeof output === "string") {
        return output;
      }
      try {
        return JSON.stringify(output);
      } catch {
        return fallback;
      }
    };

    const newMessages: RichMessage[] = [];
    const ts = () => Date.now();
    for (const item of items) {
      if (item.kind === "thinking") {
        continue;
      } else if (item.kind === "text" && item.content.trim()) {
        newMessages.push({
          kind: "assistant-text",
          id: `msg_${messageCounterRef.current++}`,
          content: item.content,
          ts: ts(),
        });
      } else if (item.kind === "tool-status") {
        const args =
          item.toolInput && Object.keys(item.toolInput).length > 0
            ? item.toolInput
            : undefined;
        newMessages.push({
          kind: "tool-call",
          id: `msg_${messageCounterRef.current++}`,
          toolName: item.toolName,
          toolCallId: item.toolCallId,
          ...(args ? { args } : {}),
          ts: ts(),
        });
        if (
          item.toolResultData &&
          Object.keys(item.toolResultData).length > 0
        ) {
          newMessages.push({
            kind: "tool-result",
            id: `msg_${messageCounterRef.current++}`,
            toolName: item.toolName,
            toolCallId: item.toolCallId,
            summary: item.label,
            data: item.toolResultData,
            ts: ts(),
          });
        } else if (item.status === "done" && item.toolOutput !== undefined) {
          newMessages.push({
            kind: "tool-result",
            id: `msg_${messageCounterRef.current++}`,
            toolName: item.toolName,
            toolCallId: item.toolCallId,
            summary: summaryFromOutput(item.toolOutput, item.label),
            data: toolOutputToData(item.toolOutput),
            ts: ts(),
          });
        } else if (item.status === "error") {
          newMessages.push({
            kind: "tool-result",
            id: `msg_${messageCounterRef.current++}`,
            toolName: item.toolName,
            toolCallId: item.toolCallId,
            summary: item.errorMessage ?? "Tool error",
            data: {
              error: true,
              message: item.errorMessage ?? "Tool error",
            },
            ts: ts(),
          });
        }
      }
    }

    if (newMessages.length) {
      setMessages((prev) => [...prev, ...newMessages]);
    }
    setActive([]);
  }, [setActive]);

  const syncMessagesFromServer = useCallback(async () => {
    if (!getConversationEndpoint) return;
    try {
      const data = await apiCall<ConversationLoadResponse>(
        getConversationEndpoint(conversationId),
      );
      setMessages(data.messages ?? []);
    } catch {
      finalizeTurn();
    }
    setActive([]);
  }, [
    apiCall,
    conversationId,
    finalizeTurn,
    getConversationEndpoint,
    setActive,
  ]);

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: RichMessage = {
      kind: "user-text",
      id: `msg_${messageCounterRef.current++}`,
      content: trimmed,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setError(null);
    clearRemotePoll();
    setLoading(true);
    setActive([]);
    setWaitingForNextStep(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let streamCompletedOk = false;

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
        return;
      }

      onStreamAccepted?.();

      const reader = response.body?.getReader();
      if (!reader) {
        setError("Streaming not supported");
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
        }
      }

      streamCompletedOk = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled — ignore
      } else {
        setError("Failed to get a response. Please try again.");
      }
    } finally {
      setWaitingForNextStep(false);
      setLoading(false);
      abortControllerRef.current = null;
      if (getConversationEndpoint && streamCompletedOk) {
        await syncMessagesFromServer();
      } else if (getConversationEndpoint) {
        setActive([]);
      } else {
        finalizeTurn();
        setActive([]);
      }
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
    onStreamAccepted,
    setActive,
    finalizeTurn,
    syncMessagesFromServer,
    getConversationEndpoint,
    nextId,
    clearRemotePoll,
  ]);

  // ---------------------------------------------------------------------------
  // newChat
  // ---------------------------------------------------------------------------

  const newChat = useCallback(() => {
    abortControllerRef.current?.abort();
    clearRemotePoll();
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
  }, [conversationStorageKey, clearRemotePoll, setActive]);

  // ---------------------------------------------------------------------------
  // loadConversation: switch to an existing conversation by ID
  // ---------------------------------------------------------------------------

  const loadConversation = useCallback(
    async (id: string) => {
      abortControllerRef.current?.abort();
      clearRemotePoll();
      if (conversationStorageKey) {
        sessionStorage.setItem(conversationStorageKey, id);
      }
      setConversationId(id);
      setMessages([]);
      setActive([]);
      setError(null);
      setWaitingForNextStep(false);
      if (getConversationEndpoint) {
        setLoading(true);
      } else {
        setLoading(false);
      }
    },
    [
      clearRemotePoll,
      conversationStorageKey,
      getConversationEndpoint,
      setActive,
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
