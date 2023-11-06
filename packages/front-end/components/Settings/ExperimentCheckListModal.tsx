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
  key: number;
  newTaskInput: ChecklistTask | undefined;
  setNewTaskInput: (task: ChecklistTask | undefined) => void;
  isNewTask?: boolean;
};

type TaskProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

type CreatableSelectWrapperProps = Omit<SortableProps, "id">;

function CreatableSelectWrapper({
  experimentLaunchChecklist,
  setExperimentLaunchChecklist,
  item,
  key,
  newTaskInput,
  setNewTaskInput,
  isNewTask = false,
}: CreatableSelectWrapperProps) {
  const [showDeleteBtn, setShowDeleteBtn] = useState(false);

  function handleOnChange(option: AutoChecklistOptions, isNewTask: boolean) {
    if (!option) return;
    if (isNewTask && newTaskInput && setNewTaskInput) {
      const updatedNewTaskInput = newTaskInput;
      updatedNewTaskInput.task = option.value;
      updatedNewTaskInput.completionType = "auto";
      updatedNewTaskInput.propertyKey = option.propertyKey;
      const updatedChecklist = [...experimentLaunchChecklist];
      updatedChecklist.push(updatedNewTaskInput);
      setExperimentLaunchChecklist(updatedChecklist);
      setNewTaskInput(undefined);
    } else {
      const updatedChecklist = [...experimentLaunchChecklist];
      updatedChecklist[key].task = option.value;
      updatedChecklist[key].completionType = "auto";
      updatedChecklist[key].propertyKey = option.propertyKey;
      setExperimentLaunchChecklist(updatedChecklist);
    }
  }

  function handleOnCreate(inputValue: string, isNewTask: boolean) {
    if (isNewTask && newTaskInput && setNewTaskInput) {
      const updatedChecklist = [...experimentLaunchChecklist];
      const updatedNewTaskInput = newTaskInput;
      updatedNewTaskInput.task = inputValue;
      updatedChecklist.push(updatedNewTaskInput);
      setExperimentLaunchChecklist(updatedChecklist);
      setNewTaskInput(undefined);
    } else {
      const updatedChecklist = [...experimentLaunchChecklist];
      updatedChecklist[key].task = inputValue;
      updatedChecklist[key].completionType = "manual";
      setExperimentLaunchChecklist(updatedChecklist);
    }
  }

  function addNewTask(e: React.MouseEvent<HTMLElement>) {
    e.preventDefault();
    const newChecklist = [...experimentLaunchChecklist];
    newChecklist.splice(key, 1);
    setExperimentLaunchChecklist(newChecklist);
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
        onChange={(option: AutoChecklistOptions) =>
          handleOnChange(option, isNewTask)
        }
        onCreateOption={(inputValue) => handleOnCreate(inputValue, isNewTask)}
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
        onClick={(e) => addNewTask(e)}
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
      key,
      handle,
      isNewTask = false,
      newTaskInput,
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
          key={key}
          item={item}
          newTaskInput={newTaskInput}
          setNewTaskInput={setNewTaskInput}
          isNewTask
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
                    newTaskInput={newTaskInput}
                    setNewTaskInput={setNewTaskInput}
                  />
                )
              )}
            </SortableContext>
          </DndContext>
          {newTaskInput ? (
            <SortableChecklistItem
              id={newTaskInput.task}
              key={experimentLaunchChecklist.length - 1 || 0}
              item={newTaskInput}
              experimentLaunchChecklist={experimentLaunchChecklist}
              setExperimentLaunchChecklist={setExperimentLaunchChecklist}
              newTaskInput={newTaskInput}
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
