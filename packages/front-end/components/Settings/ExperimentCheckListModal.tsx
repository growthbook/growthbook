import { forwardRef, useState } from "react";
import CreatableSelect from "react-select/creatable";
import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "back-end/types/experimentLaunchChecklist";
import { FaBars, FaTimes } from "react-icons/fa";
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
  experimentLaunchChecklist: ChecklistTask[];
  setExperimentLaunchChecklist: (checklist: ChecklistTask[] | []) => void;
  item: ChecklistTask;
  setNewTaskInput: (task: ChecklistTask | undefined) => void;
  isNewTask?: boolean;
};

type TaskProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

type CreatableSelectWrapperProps = Omit<SortableProps, "id" | "newTask">;

function CreatableSelectWrapper({
  experimentLaunchChecklist,
  setExperimentLaunchChecklist,
  item,
  setNewTaskInput,
}: CreatableSelectWrapperProps) {
  const [showDeleteBtn, setShowDeleteBtn] = useState(false);

  const index = experimentLaunchChecklist.findIndex(
    (checklist) => checklist.task === item.task
  );

  function handleChange(option: string | AutoChecklistOptions) {
    const updatedChecklist = [...experimentLaunchChecklist];

    const isOptionString = typeof option === "string";

    const updatedOption: ChecklistTask = {
      task: isOptionString ? option : option.value,
      completionType: isOptionString ? "manual" : "auto",
    };

    if (!isOptionString) {
      updatedOption.propertyKey = option.propertyKey;
    }

    // If this is an existing task, update it
    if (index >= 0) {
      updatedChecklist[index] = updatedOption;
    } else {
      // Otherwise, this is a new task, so add it to the end of the list
      updatedChecklist.push(updatedOption);
      setNewTaskInput(undefined);
    }

    setExperimentLaunchChecklist(updatedChecklist);
  }

  function removeTask(e: React.MouseEvent<HTMLElement>) {
    if (index === -1) {
      setNewTaskInput(undefined);
    } else {
      e.preventDefault();
      const newChecklist = [...experimentLaunchChecklist];
      newChecklist.splice(index, 1);
      setExperimentLaunchChecklist(newChecklist);
    }
  }
  return (
    <div
      className="d-flex align-items-center w-100"
      onMouseEnter={() => setShowDeleteBtn(true)}
      onMouseLeave={() => setShowDeleteBtn(false)}
    >
      <CreatableSelect
        className="w-100 pl-3"
        isMulti={false}
        options={autoChecklistOptions.filter((option) => {
          return !experimentLaunchChecklist.some(
            (index) => index.task === option.value
          );
        })}
        placeholder="Select a task or start typing to create your own"
        onChange={(option: AutoChecklistOptions) => handleChange(option)}
        onCreateOption={(inputValue) => handleChange(inputValue)}
        noOptionsMessage={() => "Start typing to create a new task"}
        value={
          item.task
            ? {
                label: item.task,
                value: item.task,
                propertyKey: item.propertyKey,
              }
            : null
        }
      />
      <button
        className="btn"
        style={{
          color: "red",
          visibility: showDeleteBtn ? "visible" : "hidden",
        }}
        onClick={(e) => removeTask(e)}
      >
        <FaTimes />
      </button>
    </div>
  );
}

// eslint-disable-next-line
export const ChecklistItem = forwardRef<HTMLDivElement, TaskProps>(
  (
    {
      experimentLaunchChecklist,
      setExperimentLaunchChecklist,
      item,
      handle,
      isNewTask = false,
      setNewTaskInput,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        {...props}
        className="d-flex align-items-center p-3 my-2 rounded bg-light"
      >
        <div
          title="Drag and drop to re-order rules"
          className="mr-2"
          {...(isNewTask ? {} : handle)}
        >
          {isNewTask ? (
            <Tooltip body="You must enter a task before you can drag and drop it.">
              <FaBars />
            </Tooltip>
          ) : (
            <FaBars />
          )}
        </div>
        <CreatableSelectWrapper
          experimentLaunchChecklist={experimentLaunchChecklist}
          setExperimentLaunchChecklist={setExperimentLaunchChecklist}
          item={item}
          setNewTaskInput={setNewTaskInput}
        />
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

    if (checklist?.id) {
      await apiCall(`/experiments/launch-checklist/${checklist.id}`, {
        method: "PUT",
        body: JSON.stringify({ tasks }),
      });
    } else {
      await apiCall(`/experiments/launch-checklist`, {
        method: "POST",
        body: JSON.stringify({
          tasks,
        }),
      });
    }
    mutate();
  }

  function getTaskIndex(task: string) {
    for (let i = 0; i < experimentLaunchChecklist.length; i++) {
      if (experimentLaunchChecklist[i].task === task) return i;
    }
    return -1;
  }

  return (
    <Modal
      open={true}
      close={close}
      size="max"
      header={`${
        checklist?.id ? "Edit" : "Add"
      } Experiment Pre-Launch Checklist`}
      cta="Save"
      submit={() => handleSubmit()}
    >
      <div>
        <p>
          Ensure all experiments meet essential criteria before launch by
          customizing your organizations pre-launch checklist. Choose from our
          pre-defined options, or create your own custom launch requirements.
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
                    id={item.task}
                    key={i}
                    item={item}
                    experimentLaunchChecklist={experimentLaunchChecklist}
                    setExperimentLaunchChecklist={setExperimentLaunchChecklist}
                    setNewTaskInput={setNewTaskInput}
                  />
                )
              )}
            </SortableContext>
          </DndContext>
          {newTaskInput ? (
            <SortableChecklistItem
              id={newTaskInput.task}
              item={newTaskInput}
              experimentLaunchChecklist={experimentLaunchChecklist}
              setExperimentLaunchChecklist={setExperimentLaunchChecklist}
              setNewTaskInput={setNewTaskInput}
              isNewTask={true}
            />
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
