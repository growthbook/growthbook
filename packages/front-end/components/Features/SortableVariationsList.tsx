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
import { Variation } from "back-end/types/experiment";
import { SortableVariation } from "./SortableFeatureVariationRow";

const SortableVariationsList: FC<{
  children: ReactNode;
  variations: (SortableVariation | Variation)[];
  setVariations?: (variations: (SortableVariation | Variation)[]) => void;
  blockedVariations?: number[];
  setBlockedVariations?: (variations: number[]) => void;
  sortingStrategy?: "vertical" | "rect";
}> = ({
  children,
  variations,
  setVariations,
  blockedVariations = [],
  setBlockedVariations,
  sortingStrategy = "vertical",
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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

          const newVariations = arrayMove<SortableVariation | Variation>(
            variations,
            oldIndex,
            newIndex
          );

          setVariations(newVariations);

          if (setBlockedVariations) {
            let newBlockedVariations = [...blockedVariations];
            const blockedIndex = blockedVariations.indexOf(oldIndex);
            if (blockedIndex !== -1) {
              newBlockedVariations.splice(blockedIndex, 1);
              newBlockedVariations.splice(newIndex, 0, oldIndex);
              setBlockedVariations(newBlockedVariations);
            }
          }
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
