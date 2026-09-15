import { useState, useEffect, useRef } from "react";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat";

const DEFAULT_DWELL_MS = 1200;
const DEFAULT_FADE_MS = 250;

export type CollapsePhase = "visible" | "fading" | "collapsed";

function getItemKey(item: ActiveTurnItem): string {
  return item.kind === "tool-status" ? item.toolCallId : item.id;
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

interface UseCollapsibleActiveTurnItemsOptions {
  /**
   * Items that match this predicate stay visible (never get superseded and
   * collapsed) — useful for "pinned" artifacts like rendered charts that
   * should remain after subsequent steps appear. Defaults to no pinning.
   */
  isPinned?: (item: ActiveTurnItem) => boolean;
  /** How long a completed, superseded item stays at full opacity before fading. */
  dwellMs?: number;
  /**
   * Duration of the fade animation. Must stay in sync with the CSS
   * `gb-ai-collapse-out` keyframe in `AIChatPrimitives.module.scss`.
   */
  fadeMs?: number;
}

/**
 * Manages the collapse lifecycle for active-turn items during streaming.
 *
 * Items that are superseded (have a successor and are not pinned) go through:
 *   visible → (typewriter completes) → dwell → fading → collapsed
 *
 * Collapsed items are returned separately so the UI can render them inside a
 * togglable "N steps" indicator.
 */
export function useCollapsibleActiveTurnItems(
  activeTurnItems: ActiveTurnItem[],
  displayedTextMap: Map<string, string>,
  options: UseCollapsibleActiveTurnItemsOptions = {},
): {
  collapsedItems: ActiveTurnItem[];
  visibleItems: { item: ActiveTurnItem; phase: CollapsePhase }[];
} {
  const {
    isPinned,
    dwellMs = DEFAULT_DWELL_MS,
    fadeMs = DEFAULT_FADE_MS,
  } = options;

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

      if (
        isLast ||
        (isPinned && isPinned(item)) ||
        scheduledRef.current.has(key)
      ) {
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
        }, fadeMs);
        timersRef.current.set(key + "_fade", fadeTimer);
      }, dwellMs);
      timersRef.current.set(key, dwellTimer);
    }
  }, [activeTurnItems, displayedTextMap, isPinned, dwellMs, fadeMs]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

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
