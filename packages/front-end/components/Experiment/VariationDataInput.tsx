import { Variation } from "back-end/types/experiment";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { generateVariationId } from "@/services/features";
import { GBAddCircle } from "../Icons";
import { DraggableVariationData } from "./DraggableVariationData";

export interface Props {
  variations: Variation[];
  setVariations?: (variations: Variation[]) => void;
  className?: string;
}

export default function VariationDataInput({
  variations,
  setVariations,
  className = "",
}: Props) {
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
    <div className={className}>
      <label>Variations</label>
      <div className="row">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (active.id !== over.id) {
              const oldIndex = getVariationIndex(active.id);
              const newIndex = getVariationIndex(over.id);

              if (oldIndex === -1 || newIndex === -1) return;

              const newVariations = arrayMove(variations, oldIndex, newIndex);

              setVariations(newVariations);
            }
          }}
        >
          <SortableContext items={variations} strategy={rectSortingStrategy}>
            {variations.map((draggableVariation, i) => (
              <DraggableVariationData
                i={i}
                variation={draggableVariation}
                variations={variations}
                setVariations={setVariations}
                key={draggableVariation.id}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div
          className="col-lg-6 col-md-6 mb-2 text-center"
          style={{ minWidth: 200 }}
        >
          <div
            className="p-3 h-100 d-flex align-items-center justify-content-center"
            style={{ border: "1px dashed #C2C5D6", borderRadius: "3px" }}
          >
            <button
              className="btn btn-outline-primary"
              onClick={(e) => {
                e.preventDefault();
                const newVariations = [...variations];
                newVariations.push({
                  name: `Variation ${variations.length}`,
                  description: "",
                  key: "",
                  value: "",
                  screenshots: [],
                  id: generateVariationId(),
                });
                setVariations(newVariations);
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block">
                <GBAddCircle />
              </span>{" "}
              Add Variation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
