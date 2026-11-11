import type { CSSProperties } from "react";
import { UniqueIdentifier } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * `useSortable` with the item's style worked out:
 * - dragged item is lifted over the items it crosses
 * - translate only; scaling stretches items of different heights
 */
export default function useSortableItem(id: UniqueIdentifier) {
  const sortable = useSortable({ id });
  const { attributes, listeners, transform, transition, isDragging } = sortable;
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging && { position: "relative", zIndex: 1 }),
  };
  return { ...sortable, style, handle: { ...attributes, ...listeners } };
}
