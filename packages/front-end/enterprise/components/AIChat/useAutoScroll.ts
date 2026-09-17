import { useCallback, useEffect, useRef } from "react";
import type {
  ActiveTurnItem,
  AIChatMessage,
} from "@/enterprise/hooks/useAIChat";

const BOTTOM_THRESHOLD_PX = 80;

export function useAutoScroll({
  messages,
  activeTurnItems,
  displayedTextMap,
  conversationId,
  enabled = true,
}: {
  messages: AIChatMessage[];
  activeTurnItems: ActiveTurnItem[];
  displayedTextMap: Map<string, string>;
  conversationId: string;
  enabled?: boolean;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const nextScrollBehaviorRef = useRef<ScrollBehavior>("auto");

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const resumeAutoScroll = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      shouldAutoScrollRef.current = true;
      nextScrollBehaviorRef.current = behavior;
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    resumeAutoScroll("auto");
    scrollToBottom("auto");
  }, [conversationId, enabled, resumeAutoScroll, scrollToBottom]);

  useEffect(() => {
    if (!enabled || !shouldAutoScrollRef.current) return;
    const behavior = nextScrollBehaviorRef.current;
    nextScrollBehaviorRef.current = "auto";
    scrollToBottom(behavior);
  }, [messages, activeTurnItems, displayedTextMap, enabled, scrollToBottom]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    let previousTouchY: number | null = null;
    const detach = () => {
      shouldAutoScrollRef.current = false;
      el.scrollTo({ top: el.scrollTop, behavior: "auto" });
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        detach();
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      previousTouchY = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const currentTouchY = event.touches[0]?.clientY ?? null;
      if (currentTouchY === null || previousTouchY === null) return;
      if (currentTouchY > previousTouchY) {
        detach();
      }
      previousTouchY = currentTouchY;
    };

    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
    };
  }, [enabled]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < BOTTOM_THRESHOLD_PX;

    shouldAutoScrollRef.current = isNearBottom;
  }, []);

  return {
    scrollContainerRef,
    messagesEndRef,
    handleScroll,
    resumeAutoScroll,
  };
}
