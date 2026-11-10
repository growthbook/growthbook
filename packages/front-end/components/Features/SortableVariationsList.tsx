import { FC, ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { Variation } from "shared/types/experiment";
import type { SortableVariation } from "./SortableFeatureVariationRow";

/** Moves a variation; keys that track position are renumbered to match. */
export function reorderVariations<T extends { id: string; value?: string }>(
  variations: T[],
  from: number,
  to: number,
  renumberKeys: boolean,
): T[] {
  const moved = arrayMove(variations, from, to);
  if (!renumberKeys) return moved;
  return moved.map((v, i) =>
    v.value === undefined ? v : { ...v, value: i + "" },
  );
}

const SortableVariationsList: FC<{
  children: ReactNode;
  variations: (SortableVariation | Variation)[];
  setVariations?: (variations: (SortableVariation | Variation)[]) => void;
  valuesAsIds?: boolean;
  // valuesAsIds will mean we don't show ids to be edited, only values,
  // so by default we will renormalize variation keys on sort. however,
  // sometimes we want to force it even in other cases where moving around
  // variations when not editing IDs was causing cases where keys were the
  // same for multiple variations.
  forceRenormalizeVariationKeysOnSort?: boolean;
  sortingStrategy?: "vertical" | "rect";
}> = ({
  children,
  variations,
  setVariations,
  valuesAsIds = false,
  forceRenormalizeVariationKeysOnSort = false,
  sortingStrategy = "vertical",
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function getVariationIndex(id: string) {
    for (let i = 0; i < variations.length; i++) {
      if (variations[i].id === id) return i;
    }
    return -1;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!setVariations) return;

        if (over && active.id !== over.id) {
          const oldIndex = getVariationIndex(active.id);
          const newIndex = getVariationIndex(over.id);

          if (oldIndex === -1 || newIndex === -1) return;

          setVariations(
            reorderVariations(
              variations,
              oldIndex,
              newIndex,
              valuesAsIds || forceRenormalizeVariationKeysOnSort,
            ),
          );
        }
      }}
    >
      <SortableContext
        items={variations}
        strategy={
          sortingStrategy === "vertical"
            ? verticalListSortingStrategy
            : rectSortingStrategy
        }
      >
        {children}
      </SortableContext>
    </DndContext>
  );
};

export default SortableVariationsList;
