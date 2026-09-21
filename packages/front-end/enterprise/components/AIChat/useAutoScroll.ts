import { useCallback, useEffect, useRef } from "react";
import type {
  ActiveTurnItem,
  AIChatMessage,
} from "@/enterprise/hooks/useAIChat";

const BOTTOM_THRESHOLD_PX = 80;
// Fraction of the remaining distance covered per frame. Exponential ease-out
// so small typewriter increments glide and large insertions don't snap.
const FOLLOW_EASING = 0.2;
const FOLLOW_SETTLED_PX = 0.5;
// Scroll positions within this many px of where the follow loop last wrote
// are ours, not the user's.
const PROGRAMMATIC_SCROLL_TOLERANCE_PX = 1.5;

export function getFollowScrollStep(remaining: number): number {
  if (Math.abs(remaining) <= FOLLOW_SETTLED_PX) return remaining;
  const eased = remaining * FOLLOW_EASING;
  return Math.abs(eased) < 1 ? Math.sign(remaining) : eased;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Not used by the follow loop; kept for the deprecated Explorer chat.
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const userDetachedRef = useRef(false);
  const previousScrollTopRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  // Last scrollTop written by us. Stays set after the loop settles so the
  // trailing async scroll event isn't misread as the user scrolling.
  const programmaticScrollTopRef = useRef<number | null>(null);

  const stopFollowing = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    programmaticScrollTopRef.current = null;
  }, []);

  const isProgrammaticPosition = useCallback((el: HTMLElement) => {
    const written = programmaticScrollTopRef.current;
    return (
      written !== null &&
      Math.abs(el.scrollTop - written) <= PROGRAMMATIC_SCROLL_TOLERANCE_PX
    );
  }, []);

  const syncFromUserScroll = useCallback(
    (el: HTMLElement) => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const isNearBottom = distanceFromBottom < BOTTOM_THRESHOLD_PX;

      if (userDetachedRef.current) {
        const movedTowardBottom = el.scrollTop > previousScrollTopRef.current;
        previousScrollTopRef.current = el.scrollTop;
        if (!movedTowardBottom || !isNearBottom) return;
        userDetachedRef.current = false;
      } else {
        previousScrollTopRef.current = el.scrollTop;
      }

      shouldAutoScrollRef.current = isNearBottom;
      if (!isNearBottom) stopFollowing();
    },
    [stopFollowing],
  );

  const snapToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight - el.clientHeight;
    programmaticScrollTopRef.current = el.scrollTop;
    previousScrollTopRef.current = el.scrollTop;
  }, []);

  const startFollowing = useCallback(() => {
    if (frameRef.current !== null) return;
    if (prefersReducedMotion()) {
      snapToBottom();
      return;
    }

    const step = () => {
      frameRef.current = null;
      const el = scrollContainerRef.current;
      if (!el) return;
      // A scrollbar drag between frames won't have reached handleScroll yet.
      if (
        programmaticScrollTopRef.current !== null &&
        !isProgrammaticPosition(el)
      ) {
        syncFromUserScroll(el);
      }
      if (!shouldAutoScrollRef.current) return;

      const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
      const delta = getFollowScrollStep(remaining);
      if (delta !== 0) {
        const before = el.scrollTop;
        el.scrollTop += delta;
        programmaticScrollTopRef.current = el.scrollTop;
        previousScrollTopRef.current = el.scrollTop;
        // Sub-pixel rounding can leave `remaining` just over the settle
        // threshold at the true bottom; a no-op write means we're there.
        if (el.scrollTop === before) return;
      }
      if (Math.abs(remaining) <= FOLLOW_SETTLED_PX) return;
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
  }, [isProgrammaticPosition, snapToBottom, syncFromUserScroll]);

  const resumeAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = true;
    userDetachedRef.current = false;
  }, []);

  useEffect(() => stopFollowing, [stopFollowing]);

  useEffect(() => {
    if (!enabled) return;
    resumeAutoScroll();
    stopFollowing();
    snapToBottom();
  }, [conversationId, enabled, resumeAutoScroll, snapToBottom, stopFollowing]);

  useEffect(() => {
    if (!enabled || !shouldAutoScrollRef.current) return;
    startFollowing();
  }, [messages, activeTurnItems, displayedTextMap, enabled, startFollowing]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    let previousTouchY: number | null = null;
    const detach = () => {
      stopFollowing();
      shouldAutoScrollRef.current = false;
      userDetachedRef.current = true;
      previousScrollTopRef.current = el.scrollTop;
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
  }, [enabled, stopFollowing]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || isProgrammaticPosition(el)) return;
    syncFromUserScroll(el);
  }, [isProgrammaticPosition, syncFromUserScroll]);

  return {
    scrollContainerRef,
    messagesEndRef,
    handleScroll,
    resumeAutoScroll,
  };
}
