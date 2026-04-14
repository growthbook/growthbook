import { useState, useRef, useCallback, useEffect } from "react";
import {
  stringifyToolResultForStorage,
  type AIChatTextPart,
  type AIChatToolCallPart,
  type AIChatToolResultPart,
} from "shared/ai-chat";
import { useAuth } from "@/services/auth";
import type {
  ActiveTurnItem,
  ConversationLoadResponse,
  AIChatMessage,
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

export function useAIChat({
  endpoint,
  buildRequestBody,
  toolStatusLabels = {},
  onSSEEvent,
  conversationStorageKey,
  getConversationEndpoint,
  getCancelEndpoint,
  onStreamAccepted,
  onConversationLoaded,
  onMessageComplete,
  onMessageCancelled,
  onMessageError,
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

  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [activeTurnItems, setActiveTurnItems] = useState<ActiveTurnItem[]>([]);
  const activeTurnItemsRef = useRef<ActiveTurnItem[]>([]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  /** True only while fetching historical messages for a conversation (not AI generation). */
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  /** True only while this tab is actively reading an SSE stream from `sendMessage`. */
  const [isLocalStream, setIsLocalStream] = useState(false);
  const [waitingForNextStep, setWaitingForNextStep] = useState(false);
  const [isRemoteStream, setIsRemoteStream] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Distinguishes user-initiated cancels from implicit aborts (new chat, navigation). */
  const userCancelledRef = useRef(false);
  /** True while sendMessage is executing — used to prevent the conversation-load
   *  effect from overwriting state during an active send. */
  const isSendingRef = useRef(false);
  const remotePollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  /** Conversation id the active remote poll is for; stale callbacks must not apply. */
  const remotePollTargetIdRef = useRef<string | null>(null);
  const getConversationEndpointRef = useRef(getConversationEndpoint);
  getConversationEndpointRef.current = getConversationEndpoint;
  const getCancelEndpointRef = useRef(getCancelEndpoint);
  getCancelEndpointRef.current = getCancelEndpoint;
  const onConversationLoadedRef = useRef(onConversationLoaded);
  onConversationLoadedRef.current = onConversationLoaded;
  const toolStatusLabelsRef = useRef(toolStatusLabels);
  toolStatusLabelsRef.current = toolStatusLabels;
  const onSSEEventRef = useRef(onSSEEvent);
  onSSEEventRef.current = onSSEEvent;
  const onStreamAcceptedRef = useRef(onStreamAccepted);
  onStreamAcceptedRef.current = onStreamAccepted;
  const onMessageCompleteRef = useRef(onMessageComplete);
  onMessageCompleteRef.current = onMessageComplete;
  const onMessageCancelledRef = useRef(onMessageCancelled);
  onMessageCancelledRef.current = onMessageCancelled;
  const onMessageErrorRef = useRef(onMessageError);
  onMessageErrorRef.current = onMessageError;

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
    setIsLoadingConversation(true);

    const run = async () => {
      try {
        const data = await apiCall<ConversationLoadResponse>(
          getEp(conversationId),
        );
        if (cancelled || isSendingRef.current) return;

        setIsLoadingConversation(false);
        setMessages(data.messages ?? []);
        onConversationLoadedRef.current?.(data);

        const isRecent =
          data.lastStreamedAt > 0 &&
          Date.now() - data.lastStreamedAt < REMOTE_STREAM_STALE_MS;

        if (data.isStreaming && isRecent) {
          setLoading(true);
          setIsRemoteStream(true);
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
                setIsRemoteStream(false);
                setLoading(false);
              }
            } catch {
              if (!cancelled && remotePollTargetIdRef.current === targetId) {
                clearRemotePoll();
                setIsRemoteStream(false);
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
        if (!cancelled && !isSendingRef.current) {
          setIsLoadingConversation(false);
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
  // finalizeTurn: convert active items to persisted AIChatMessages (fallback)
  // ---------------------------------------------------------------------------

  const finalizeTurn = useCallback(() => {
    const items = activeTurnItemsRef.current;
    if (!items.length) return;

    const assistantParts: (AIChatTextPart | AIChatToolCallPart)[] = [];
    const toolResultParts: AIChatToolResultPart[] = [];
    const now = Date.now();

    for (const item of items) {
      if (item.kind === "thinking") continue;

      if (item.kind === "text" && item.content.trim()) {
        assistantParts.push({ type: "text", text: item.content });
      } else if (item.kind === "tool-status") {
        const args =
          item.toolInput && Object.keys(item.toolInput).length > 0
            ? item.toolInput
            : undefined;
        assistantParts.push({
          type: "tool-call",
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          args: args ?? {},
        });

        if (item.status === "error") {
          toolResultParts.push({
            type: "tool-result",
            toolCallId: item.toolCallId,
            toolName: item.toolName,
            isError: true,
            result: stringifyToolResultForStorage({
              error: true,
              message: item.errorMessage ?? "Tool error",
            }),
          });
        } else if (item.status === "done" && item.toolOutput !== undefined) {
          toolResultParts.push({
            type: "tool-result",
            toolCallId: item.toolCallId,
            toolName: item.toolName,
            result: stringifyToolResultForStorage(item.toolOutput),
          });
        } else if (
          item.toolResultData &&
          Object.keys(item.toolResultData).length > 0
        ) {
          toolResultParts.push({
            type: "tool-result",
            toolCallId: item.toolCallId,
            toolName: item.toolName,
            result: stringifyToolResultForStorage(item.toolResultData),
          });
        }
      }
    }

    const newMessages: AIChatMessage[] = [];
    if (assistantParts.length > 0) {
      newMessages.push({
        role: "assistant",
        id: `msg_${messageCounterRef.current++}`,
        ts: now,
        content: assistantParts,
      });
    }
    if (toolResultParts.length > 0) {
      newMessages.push({
        role: "tool",
        id: `msg_${messageCounterRef.current++}`,
        ts: now,
        content: toolResultParts,
      });
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
      onConversationLoadedRef.current?.(data);
      setError(null);
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
  // cancelGeneration: stop the active live stream
  // ---------------------------------------------------------------------------

  const cancelGeneration = useCallback(() => {
    if (!isLocalStream) return;
    userCancelledRef.current = true;
    const cancelEp = getCancelEndpointRef.current;
    if (cancelEp) {
      void apiCall(cancelEp(conversationId), { method: "POST" }).catch(
        () => {},
      );
    }
    abortControllerRef.current?.abort();
  }, [isLocalStream, apiCall, conversationId]);

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (messageOverride?: string) => {
      const trimmed = (messageOverride ?? input).trim();
      if (!trimmed || loading) return;

      const userMessage: AIChatMessage = {
        role: "user",
        id: `msg_${messageCounterRef.current++}`,
        content: trimmed,
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setError(null);
      clearRemotePoll();
      setLoading(true);
      setIsRemoteStream(false);
      setActive([]);
      setWaitingForNextStep(false);
      isSendingRef.current = true;

      const controller = new AbortController();
      abortControllerRef.current = controller;
      userCancelledRef.current = false;

      let streamCompletedOk = false;
      const sendStartMs = Date.now();
      let toolCallCount = 0;

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
            onMessageErrorRef.current?.({
              errorType: "rate-limit",
              httpStatus: response.status,
            });
          } else {
            setError(errorData?.message || `Error: ${response.status}`);
            onMessageErrorRef.current?.({
              errorType: "http-error",
              httpStatus: response.status,
            });
          }
          return;
        }

        onStreamAcceptedRef.current?.();
        setIsLocalStream(true);

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
            if (event.type === "tool-call-start") toolCallCount++;
            onSSEEventRef.current?.(event);

            const result = processSSEEvent(
              event,
              activeTurnItemsRef.current,
              toolStatusLabelsRef.current,
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
          onMessageErrorRef.current?.({
            errorType: "stream-failed",
          });
        }
      } finally {
        const wasCancelled = userCancelledRef.current;
        const durationMs = Date.now() - sendStartMs;
        userCancelledRef.current = false;
        isSendingRef.current = false;

        if (streamCompletedOk) {
          onMessageCompleteRef.current?.({ durationMs, toolCallCount });
        } else if (wasCancelled) {
          onMessageCancelledRef.current?.({ durationMs });
        }
        setWaitingForNextStep(false);
        setLoading(false);
        setIsLocalStream(false);
        abortControllerRef.current = null;

        if (getConversationEndpoint && streamCompletedOk) {
          // Normal completion — sync the persisted messages from the server.
          await syncMessagesFromServer();
        } else if (getConversationEndpoint && wasCancelled) {
          // User cancelled — give the backend a moment to flush and persist the
          // partial response before syncing, then show whatever was saved.
          await new Promise((resolve) => setTimeout(resolve, 600));
          await syncMessagesFromServer();
        } else if (getConversationEndpoint) {
          // Navigation / new-chat abort — don't sync, just clear.
          setActive([]);
        } else {
          // No server persistence — commit whatever was streamed locally.
          finalizeTurn();
          setActive([]);
        }
      }
    },
    [
      input,
      loading,
      fetchRaw,
      endpoint,
      buildRequestBody,
      conversationId,
      setActive,
      finalizeTurn,
      syncMessagesFromServer,
      getConversationEndpoint,
      nextId,
      clearRemotePoll,
    ],
  );

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
    setIsLoadingConversation(false);
    setIsLocalStream(false);
    setWaitingForNextStep(false);
    setIsRemoteStream(false);
  }, [conversationStorageKey, clearRemotePoll, setActive]);

  // ---------------------------------------------------------------------------
  // loadConversation: switch to an existing conversation by ID
  // ---------------------------------------------------------------------------

  const loadConversation = useCallback(
    async (id: string) => {
      if (id === conversationId) return;
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
      setIsRemoteStream(false);
      if (getConversationEndpoint) {
        setLoading(true);
      } else {
        setLoading(false);
      }
    },
    [
      clearRemotePoll,
      conversationId,
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
    cancelGeneration,
    newChat,
    loadConversation,
    loading,
    isLoadingConversation,
    isLocalStream,
    waitingForNextStep,
    isRemoteStream,
    error,
    input,
    setInput,
    conversationId,
  };
}
