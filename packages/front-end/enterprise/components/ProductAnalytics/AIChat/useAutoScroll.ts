import { useRef, useEffect, useCallback } from "react";
import type {
  ActiveTurnItem,
  AIChatMessage,
} from "@/enterprise/hooks/useAIChat";

export function useAutoScroll(
  messages: AIChatMessage[],
  activeTurnItems: ActiveTurnItem[],
  conversationId: string,
) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeTurnItems]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [conversationId]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  return { scrollContainerRef, messagesEndRef, handleScroll };
}
