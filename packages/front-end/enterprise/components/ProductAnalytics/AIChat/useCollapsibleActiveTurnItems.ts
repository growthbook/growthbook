import { useState, useEffect, useRef } from "react";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat";
import { chartDataFromRecord } from "./ExplorationBubble";

const DWELL_MS = 1200;
const FADE_MS = 350;

export const COLLAPSE_FADE_MS = FADE_MS;

export type CollapsePhase = "visible" | "fading" | "collapsed";

function getItemKey(item: ActiveTurnItem): string {
  return item.kind === "tool-status" ? item.toolCallId : item.id;
}

function isChartItem(item: ActiveTurnItem): boolean {
  return (
    item.kind === "tool-status" &&
    item.status === "done" &&
    !!item.toolResultData &&
    chartDataFromRecord(item.toolResultData) !== null
  );
}

function isItemComplete(
  item: ActiveTurnItem,
  displayedTextMap: Map<string, string>,
): boolean {
  if (item.kind === "text") {
    const displayed = displayedTextMap.get(item.id) ?? "";
    return displayed.length >= item.content.length;
  }
  if (item.kind === "tool-status") {
    return item.status === "done" || item.status === "error";
  }
  return true;
}

/**
 * Manages the collapse lifecycle for active-turn items during streaming.
 *
 * Items that are superseded (have a successor and are not charts) go through:
 *   visible → (typewriter completes) → dwell (DWELL_MS) → fading (FADE_MS) → collapsed
 *
 * Collapsed items are returned separately so the UI can render them inside a
 * togglable "N steps" indicator.
 */
export function useCollapsibleActiveTurnItems(
  activeTurnItems: ActiveTurnItem[],
  displayedTextMap: Map<string, string>,
): {
  collapsedItems: ActiveTurnItem[];
  visibleItems: { item: ActiveTurnItem; phase: CollapsePhase }[];
} {
  const [phases, setPhases] = useState<Map<string, CollapsePhase>>(new Map());
  const scheduledRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Reset when active items are cleared (stream ended, new chat, etc.)
  useEffect(() => {
    if (activeTurnItems.length === 0) {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      scheduledRef.current.clear();
      setPhases((prev) => (prev.size > 0 ? new Map() : prev));
    }
  }, [activeTurnItems.length]);

  // Schedule collapse for superseded, complete items
  useEffect(() => {
    if (activeTurnItems.length === 0) return;

    for (let i = 0; i < activeTurnItems.length; i++) {
      const item = activeTurnItems[i];
      const key = getItemKey(item);
      const isLast = i === activeTurnItems.length - 1;

      if (isLast || isChartItem(item) || scheduledRef.current.has(key)) {
        continue;
      }
      if (!isItemComplete(item, displayedTextMap)) continue;

      scheduledRef.current.add(key);

      const dwellTimer = setTimeout(() => {
        setPhases((prev) => new Map(prev).set(key, "fading"));
        timersRef.current.delete(key);

        const fadeTimer = setTimeout(() => {
          setPhases((prev) => new Map(prev).set(key, "collapsed"));
          timersRef.current.delete(key + "_fade");
        }, FADE_MS);
        timersRef.current.set(key + "_fade", fadeTimer);
      }, DWELL_MS);
      timersRef.current.set(key, dwellTimer);
    }
  }, [activeTurnItems, displayedTextMap]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  // Partition items into collapsed vs visible
  const collapsedItems: ActiveTurnItem[] = [];
  const visibleItems: { item: ActiveTurnItem; phase: CollapsePhase }[] = [];

  for (const item of activeTurnItems) {
    const key = getItemKey(item);
    const phase = phases.get(key);
    if (phase === "collapsed") {
      collapsedItems.push(item);
    } else {
      visibleItems.push({ item, phase: phase ?? "visible" });
    }
  }

  return { collapsedItems, visibleItems };
}
