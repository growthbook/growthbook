import { forwardRef, useState } from "react";
import CreatableSelect from "react-select/creatable";
import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "back-end/types/experimentLaunchChecklist";
import { FaBars, FaTimes } from "react-icons/fa";
import {
  DndContext,
  DragOverlay,
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
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import { GBAddCircle } from "../Icons";
import Tooltip from "../Tooltip/Tooltip";

type AutoChecklistOptions = {
  value: string;
  label: string;
  propertyKey: "hypothesis" | "screenshots" | "description" | "project" | "tag";
};

const autoChecklistOptions: AutoChecklistOptions[] = [
  {
    value: "Add a descriptive hypothesis for this experiment",
    label: "Add a descriptive hypothesis for this experiment",
    propertyKey: "hypothesis",
  },
  {
    value: "Upload a screenshot for each variation of the experiment",
    label: "Upload a screenshot for each variation of the experiment",
    propertyKey: "screenshots",
  },
  {
    value: "Add a description for this experiment",
    label: "Add a description for this experiment",
    propertyKey: "description",
  },
  {
    value: "Add this experiment to a project",
    label: "Add this experiment to a project",
    propertyKey: "project",
  },
  {
    value: "Add atleast 1 tag to this experiment",
    label: "Add atleast 1 tag to this experiment",
    propertyKey: "tag",
  },
];

type SortableProps = {
  id: string;
  experimentLaunchChecklist: ChecklistTask[] | [];
  setExperimentLaunchChecklist: (checklist: ChecklistTask[] | []) => void;
  value: string;
  propertyKey?:
    | "tag"
    | "project"
    | "description"
    | "screenshots"
    | "hypothesis";
  index: number;
};

type TaskProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

// eslint-disable-next-line
export const ChecklistItem = forwardRef<HTMLDivElement, TaskProps>(
  (
    {
      experimentLaunchChecklist,
      setExperimentLaunchChecklist,
      value,
      handle,
      propertyKey,
      index,
      ...props
    },
    ref
  ) => {
    const [showDeleteBtn, setShowDeleteBtn] = useState(false);
    return (
      <div
        ref={ref}
        {...props}
        className="d-flex align-items-center p-3 my-2 rounded bg-light"
        onMouseEnter={() => setShowDeleteBtn(true)}
        onMouseLeave={() => setShowDeleteBtn(false)}
      >
        <div
          {...handle}
          title="Drag and drop to re-order rules"
          className="mr-2"
        >
          <FaBars />
        </div>
        <CreatableSelect
          className="w-100 pl-3"
          isMulti={false}
          options={autoChecklistOptions.filter((option) => {
            return !experimentLaunchChecklist.some(
              (index) => index.task === option.value
            );
          })}
          placeholder="Select a task or start typing to create your own"
          onChange={(option: AutoChecklistOptions) => {
            if (!option) return;
            const updatedChecklist = [...experimentLaunchChecklist];
            updatedChecklist[index].task = option.value;
            updatedChecklist[index].completionType = "auto";
            updatedChecklist[index].propertyKey = option.propertyKey;
            setExperimentLaunchChecklist(updatedChecklist);
          }}
          onCreateOption={(inputValue) => {
            const updatedChecklist = [...experimentLaunchChecklist];
            updatedChecklist[index].task = inputValue;
            updatedChecklist[index].completionType = "manual";
            setExperimentLaunchChecklist(updatedChecklist);
          }}
          value={value ? { label: value, value, propertyKey } : null}
        />
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
  }
);

function SortableChecklistItem(props: SortableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    active,
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: active?.id === props.id ? 0.3 : 1,
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

export default function ExperimentCheckListModal({
  close,
  mutate,
  checklist,
}: {
  close: () => void;
  mutate: () => void;
  checklist?: ExperimentLaunchChecklistInterface;
}) {
  const { apiCall } = useAuth();
  const [activeItem, setActiveItem] = useState<string>("");
  const [experimentLaunchChecklist, setExperimentLaunchChecklist] = useState<
    ChecklistTask[]
  >(
    checklist?.tasks
      ? checklist.tasks
      : [{ task: "", completionType: "manual" }]
  );
  const [newTaskInput, setNewTaskInput] = useState<ChecklistTask | undefined>(
    undefined
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  async function handleSubmit() {
    const tasks = experimentLaunchChecklist;

    if (tasks.length && tasks[tasks.length - 1].task === "") {
      tasks.pop();
    }
    await apiCall(`/experiments/launch-checklist`, {
      method: checklist?.id ? "PUT" : "POST",
      body: JSON.stringify({
        tasks,
        id: checklist?.id,
      }),
    });
    mutate();
  }

  function getTaskIndex(task: string) {
    for (let i = 0; i < experimentLaunchChecklist.length; i++) {
      if (experimentLaunchChecklist[i].task === task) return i;
    }
    return -1;
  }

  const activeTask = activeItem
    ? experimentLaunchChecklist[getTaskIndex(activeItem)]
    : null;

  return (
    <Modal
      open={true}
      close={close}
      size="max"
      header={`${checklist?.id ? "Edit" : "Add"} Pre-Launch Checklist`}
      cta="Save"
      submit={() => handleSubmit()}
    >
      <div>
        <p>
          Ensure all experiments meet essential criteria before launch by
          customizing your organizations pre-launch checklist. Choose from our
          pre-defined list, or create your own custom launch requirements.
        </p>
        <div className="pt-3 pb-5">
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
                  newIndex
                );

                setExperimentLaunchChecklist(newRules);
              }
              setActiveItem("");
            }}
            onDragStart={async ({ active }) => {
              setActiveItem(active.id);
            }}
          >
            <h5>Pre-Launch Requirements</h5>
            <SortableContext
              items={experimentLaunchChecklist.map((item) => item.task)}
              strategy={verticalListSortingStrategy}
            >
              {experimentLaunchChecklist.map(
                (item: ChecklistTask, i: number) => (
                  <SortableChecklistItem
                    key={i}
                    value={item.task}
                    id={item.task}
                    propertyKey={item.propertyKey}
                    index={i}
                    experimentLaunchChecklist={experimentLaunchChecklist}
                    setExperimentLaunchChecklist={setExperimentLaunchChecklist}
                  />
                )
              )}
            </SortableContext>
            <DragOverlay>
              {activeTask ? (
                <ChecklistItem
                  id={activeItem}
                  key={getTaskIndex(activeItem)}
                  value={activeItem}
                  propertyKey={
                    experimentLaunchChecklist[getTaskIndex(activeItem)]
                      .propertyKey
                  }
                  index={getTaskIndex(activeItem)}
                  experimentLaunchChecklist={experimentLaunchChecklist}
                  setExperimentLaunchChecklist={setExperimentLaunchChecklist}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
          {newTaskInput ? (
            <div className="d-flex align-items-center p-3 my-2 rounded bg-light">
              <div title="Drag and drop to re-order rules" className="mr-2">
                <Tooltip body="You must enter a task before you can drag and drop it.">
                  <FaBars />
                </Tooltip>
              </div>
              <CreatableSelect
                className="w-100 pl-3"
                isMulti={false}
                options={autoChecklistOptions.filter((option) => {
                  return !experimentLaunchChecklist.some(
                    (index) => index.task === option.value
                  );
                })}
                placeholder="Select a task or start typing to create your own"
                onChange={(option: AutoChecklistOptions) => {
                  if (!option) return;
                  const updatedNewTaskInput = newTaskInput;
                  updatedNewTaskInput.task = option.value;
                  updatedNewTaskInput.completionType = "auto";
                  updatedNewTaskInput.propertyKey = option.propertyKey;
                  const updatedChecklist = [...experimentLaunchChecklist];
                  updatedChecklist.push(updatedNewTaskInput);
                  setExperimentLaunchChecklist(updatedChecklist);
                  setNewTaskInput(undefined);
                }}
                noOptionsMessage={() => "Start typing to create a new task"}
                onCreateOption={(inputValue: string) => {
                  const updatedChecklist = [...experimentLaunchChecklist];
                  const updatedNewTaskInput = newTaskInput;
                  updatedNewTaskInput.task = inputValue;
                  updatedChecklist.push(updatedNewTaskInput);
                  setExperimentLaunchChecklist(updatedChecklist);
                  setNewTaskInput(undefined);
                }}
                value={
                  newTaskInput.task
                    ? {
                        label: newTaskInput.task,
                        value: newTaskInput.task,
                        propertyKey: newTaskInput.propertyKey,
                      }
                    : null
                }
              />
              <button
                className="btn"
                style={{
                  color: "red",
                }}
                onClick={(e) => {
                  e.preventDefault();
                  setNewTaskInput(undefined);
                }}
              >
                <FaTimes />
              </button>
            </div>
          ) : null}
          <button
            className="btn btn-primary mt-3"
            disabled={!!newTaskInput}
            onClick={() => {
              setNewTaskInput({ task: "", completionType: "manual" });
            }}
          >
            <span className="h4 pr-2 m-0 d-inline-block align-top">
              <GBAddCircle />
            </span>
            Add Another Task
          </button>
        </div>
      </div>
    </Modal>
  );
}
