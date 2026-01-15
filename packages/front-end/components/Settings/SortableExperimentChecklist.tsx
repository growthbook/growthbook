import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChecklistTask } from "shared/types/experimentLaunchChecklist";
import { FaGripHorizontal, FaTimes } from "react-icons/fa";
import { CSS } from "@dnd-kit/utilities";
import { forwardRef, useState } from "react";

type SortableProps = {
  experimentLaunchChecklist: ChecklistTask[];
  setExperimentLaunchChecklist: (checklist: ChecklistTask[] | []) => void;
  item: ChecklistTask;
  index: number;
};

type ChecklistItemProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

// eslint-disable-next-line
export const ChecklistItem = forwardRef<HTMLDivElement, ChecklistItemProps>(
  (
    {
      experimentLaunchChecklist,
      setExperimentLaunchChecklist,
      item,
      index,
      handle,
      ...props
    },
    ref,
  ) => {
    const [showDeleteBtn, setShowDeleteBtn] = useState(false);
    return (
      <div
        ref={ref}
        {...props}
        className="d-flex align-items-center justify-content-between border rounded ml-3 px-3 py-2 my-1 shadow-sm"
        onMouseEnter={() => setShowDeleteBtn(true)}
        onMouseLeave={() => setShowDeleteBtn(false)}
      >
        <div className="d-flex">
          <div
            className="d-flex align-items-center mr-4"
            title="Drag and drop to re-order rules"
            {...handle}
          >
            <FaGripHorizontal />
          </div>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.task}
            </a>
          ) : (
            item.task
          )}
        </div>
        <button
          className="btn"
          style={{
            color: "red",
            visibility: showDeleteBtn ? "visible" : "hidden",
          }}
          onClick={(e) => {
            e.preventDefault();
            const newChecklist = [...experimentLaunchChecklist];
            newChecklist.splice(index, 1);
            setExperimentLaunchChecklist(newChecklist);
          }}
        >
          <FaTimes />
        </button>
      </div>
    );
  },
);

function SortableChecklistItem(props: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, active } =
    useSortable({ id: props.item.task });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: active?.id === props.item.task ? 0.3 : 1,
    backgroundColor: "var(--color-surface)",
  };

  return (
    <ChecklistItem
      {...props}
      ref={setNodeRef}
      style={style}
      handle={{ ...attributes, ...listeners }}
    />
  );
}

export default function SortableExperimentChecklist({
  experimentLaunchChecklist,
  setExperimentLaunchChecklist,
}: {
  experimentLaunchChecklist: ChecklistTask[];
  setExperimentLaunchChecklist: (checklist: ChecklistTask[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function getTaskIndex(task: string) {
    for (let i = 0; i < experimentLaunchChecklist.length; i++) {
      if (experimentLaunchChecklist[i].task === task) return i;
    }
    return -1;
  }

  return (
    <div className="py-3 pr-3 border rounded">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={async ({ active, over }) => {
          if (!over?.id) return;
          if (active.id !== over.id) {
            const oldIndex = getTaskIndex(active.id);
            const newIndex = getTaskIndex(over.id);

            if (oldIndex === -1 || newIndex === -1) return;

            const newRules = arrayMove(
              experimentLaunchChecklist,
              oldIndex,
              newIndex,
            );
            setExperimentLaunchChecklist(newRules);
          }
        }}
      >
        <SortableContext
          items={experimentLaunchChecklist.map((item) => item.task)}
          strategy={verticalListSortingStrategy}
        >
          <ol>
            {experimentLaunchChecklist.map((item: ChecklistTask, i: number) => (
              <li key={`${item}-${i}`}>
                <SortableChecklistItem
                  item={item}
                  index={i}
                  experimentLaunchChecklist={experimentLaunchChecklist}
                  setExperimentLaunchChecklist={setExperimentLaunchChecklist}
                />
              </li>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
