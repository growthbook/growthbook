import { Dispatch, MutableRefObject, SetStateAction, useEffect } from "react";
import type { ChatMessage } from "./types";
import { hydrateMessages } from "./utils";

// ---------------------------------------------------------------------------
// Reconnect / hydration hook
// ---------------------------------------------------------------------------

interface UseReconnectOptions {
  conversationId: string;
  conversationStorageKey?: string;
  getConversationEndpoint?: (id: string) => string;
  apiCall: <T>(url: string) => Promise<T>;
  messageCounterRef: MutableRefObject<number>;
  toolStatusLabels: Record<string, string>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  onRawMessages?: (messages: unknown[]) => void;
}

interface ConversationStatus {
  isStreaming: boolean;
  lastStreamedAt: number;
  messages: unknown[];
}

const STALE_THRESHOLD_MS = 60_000;
const POLL_INTERVAL_MS = 2_500;

/**
 * On mount, checks sessionStorage for a stored conversation ID, fetches its
 * status, hydrates messages, and polls until streaming finishes if needed.
 * No-ops when `conversationStorageKey` or `getConversationEndpoint` are absent.
 */
export function useReconnect({
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
}: UseReconnectOptions): void {
  useEffect(() => {
    if (!conversationStorageKey || !getConversationEndpoint) return;

    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const applyMessages = (raw: unknown[]) => {
      onRawMessages?.(raw);
      const hydrated = hydrateMessages(raw, messageCounterRef, toolStatusLabels);
      if (hydrated.length > 0) setMessages(hydrated);
    };

    const checkStatus = async () => {
      try {
        const data = await apiCall<ConversationStatus>(
          getConversationEndpoint(conversationId),
        );
        if (cancelled) return;

        if (data.messages.length > 0) {
          applyMessages(data.messages);
        }

        const isRecent =
          data.lastStreamedAt > 0 &&
          Date.now() - data.lastStreamedAt < STALE_THRESHOLD_MS;

        if (data.isStreaming && isRecent) {
          setLoading(true);
          pollInterval = setInterval(async () => {
            if (cancelled) {
              if (pollInterval) clearInterval(pollInterval);
              return;
            }
            try {
              const poll = await apiCall<ConversationStatus>(
                getConversationEndpoint(conversationId),
              );
              if (cancelled) return;
              if (!poll.isStreaming) {
                if (pollInterval) clearInterval(pollInterval);
                setLoading(false);
                applyMessages(poll.messages);
              }
            } catch {
              if (pollInterval) clearInterval(pollInterval);
              setLoading(false);
            }
          }, POLL_INTERVAL_MS);
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
}
