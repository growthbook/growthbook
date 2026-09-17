import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat";

interface UseCollapsibleActiveTurnItemsOptions {
  isPinned?: (item: ActiveTurnItem) => boolean;
}

/**
 * Keeps the latest turn item visible and groups superseded work immediately.
 * The stable activity row handles transitions without moving old rows around.
 */
export function useCollapsibleActiveTurnItems(
  activeTurnItems: ActiveTurnItem[],
  displayedTextMap: Map<string, string>,
  options: UseCollapsibleActiveTurnItemsOptions = {},
): {
  collapsedItems: ActiveTurnItem[];
  visibleItems: ActiveTurnItem[];
} {
  const collapsedItems: ActiveTurnItem[] = [];
  const visibleItems: ActiveTurnItem[] = [];

  activeTurnItems.forEach((item, index) => {
    const isLatest = index === activeTurnItems.length - 1;
    const isIncomplete =
      (item.kind === "text" &&
        (displayedTextMap.get(item.id) ?? "").length < item.content.length) ||
      (item.kind === "tool-status" && item.status === "running");
    if (isLatest || isIncomplete || options.isPinned?.(item)) {
      visibleItems.push(item);
      return;
    }
    collapsedItems.push(item);
  });

  return {
    collapsedItems,
    visibleItems,
  };
}
