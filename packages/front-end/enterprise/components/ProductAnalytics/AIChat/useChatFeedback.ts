import { useState, useCallback, useRef } from "react";
import type {
  AIChatFeedbackRating,
  AIChatFeedbackEntry,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import type { FeedbackState } from "@/enterprise/components/AIChat/AIChatFeedback";

/**
 * Manages feedback state (thumbs up/down + comment) for AI chat messages.
 *
 * Uses a ref for conversationId so the hook can be called before `useAIChat`
 * (which provides conversationId) without a circular dependency. The consumer
 * keeps `conversationIdRef.current` in sync after `useAIChat` returns.
 */
export function useChatFeedback() {
  const conversationIdRef = useRef("");
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackState>>(
    {},
  );
  const { apiCall } = useAuth();

  const handleFeedbackSubmit = useCallback(
    (
      messageId: string,
      rating: AIChatFeedbackRating | null,
      comment: string,
    ) => {
      setFeedbackMap((prev) => {
        if (rating === null) {
          const next = { ...prev };
          delete next[messageId];
          return next;
        }
        return { ...prev, [messageId]: { rating, comment } };
      });

      void apiCall(
        `/product-analytics/chat/${conversationIdRef.current}/feedback`,
        {
          method: "POST",
          body: JSON.stringify({ messageId, rating, comment }),
        },
      );
    },
    [apiCall],
  );

  const loadFeedbackFromConversation = useCallback((data: unknown) => {
    const entries = (data as { feedback?: AIChatFeedbackEntry[] }).feedback;
    if (!entries?.length) {
      setFeedbackMap({});
      return;
    }
    const map: Record<string, FeedbackState> = {};
    for (const entry of entries) {
      map[entry.messageId] = {
        rating: entry.rating,
        comment: entry.comment,
      };
    }
    setFeedbackMap(map);
  }, []);

  const clearFeedback = useCallback(() => setFeedbackMap({}), []);

  return {
    feedbackMap,
    handleFeedbackSubmit,
    loadFeedbackFromConversation,
    clearFeedback,
    conversationIdRef,
  };
}
