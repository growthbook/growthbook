import { useEffect, useRef, useState } from "react";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat";

interface UseCollapsibleActiveTurnItemsOptions {
  isPinned?: (item: ActiveTurnItem) => boolean;
  fadeSupersededText?: boolean;
}

const INTERMEDIATE_TEXT_DWELL_MS = 1500;
const INTERMEDIATE_TEXT_FADE_MS = 1200;
const INTERMEDIATE_TEXT_SETTLE_MS = 50;

/**
 * Keeps the latest turn item visible and briefly fades superseded text before
 * grouping it. Tool activity groups immediately so the status row stays stable.
 */
export function useCollapsibleActiveTurnItems(
  activeTurnItems: ActiveTurnItem[],
  displayedTextMap: Map<string, string>,
  options: UseCollapsibleActiveTurnItemsOptions = {},
): {
  collapsedItems: ActiveTurnItem[];
  visibleItems: ActiveTurnItem[];
  fadingTextIds: ReadonlySet<string>;
} {
  const [collapsedTextIds, setCollapsedTextIds] = useState<Set<string>>(
    new Set(),
  );
  const [fadingTextIds, setFadingTextIds] = useState<Set<string>>(new Set());
  const scheduledTextIdsRef = useRef<Set<string>>(new Set());
  const fadeTimersRef = useRef<Map<string, number>>(new Map());
  const { isPinned, fadeSupersededText = false } = options;

  useEffect(() => {
    if (!fadeSupersededText || activeTurnItems.length === 0) {
      for (const timer of fadeTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      fadeTimersRef.current.clear();
      scheduledTextIdsRef.current.clear();
      setCollapsedTextIds((current) =>
        current.size === 0 ? current : new Set(),
      );
      setFadingTextIds((current) => (current.size === 0 ? current : new Set()));
      return;
    }

    activeTurnItems.forEach((item, index) => {
      if (
        item.kind !== "text" ||
        index === activeTurnItems.length - 1 ||
        isPinned?.(item) ||
        scheduledTextIdsRef.current.has(item.id)
      ) {
        return;
      }

      const displayed = displayedTextMap.get(item.id) ?? "";
      if (displayed.length < item.content.length) return;

      scheduledTextIdsRef.current.add(item.id);
      const dwellTimer = window.setTimeout(() => {
        setFadingTextIds((current) => new Set(current).add(item.id));
        const fadeTimer = window.setTimeout(() => {
          setFadingTextIds((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
          setCollapsedTextIds((current) => new Set(current).add(item.id));
          fadeTimersRef.current.delete(item.id);
        }, INTERMEDIATE_TEXT_FADE_MS + INTERMEDIATE_TEXT_SETTLE_MS);
        fadeTimersRef.current.set(item.id, fadeTimer);
      }, INTERMEDIATE_TEXT_DWELL_MS);
      fadeTimersRef.current.set(item.id, dwellTimer);
    });
  }, [activeTurnItems, displayedTextMap, fadeSupersededText, isPinned]);

  useEffect(() => {
    const timers = fadeTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

  const collapsedItems: ActiveTurnItem[] = [];
  const visibleItems: ActiveTurnItem[] = [];

  activeTurnItems.forEach((item, index) => {
    const isLatest = index === activeTurnItems.length - 1;
    const isIncomplete =
      (item.kind === "text" &&
        (displayedTextMap.get(item.id) ?? "").length < item.content.length) ||
      (item.kind === "tool-status" && item.status === "running");
    const isFadingText =
      fadeSupersededText &&
      item.kind === "text" &&
      !collapsedTextIds.has(item.id);
    if (isLatest || isIncomplete || isFadingText || isPinned?.(item)) {
      visibleItems.push(item);
      return;
    }
    collapsedItems.push(item);
  });

  return {
    collapsedItems,
    visibleItems,
    fadingTextIds,
  };
}
