import CreatableSelect from "react-select/creatable";
import { ChecklistTask } from "back-end/types/experimentLaunchChecklist";
import Field from "@/components/Forms/Field";
import { ReactSelectProps } from "@/components/Forms/SelectField";

type AutoChecklistOption = {
  value: string;
  label: string;
  propertyKey: "hypothesis" | "screenshots" | "description" | "project" | "tag";
};

export default function NewExperimentChecklistItem({
  experimentLaunchChecklist,
  setExperimentLaunchChecklist,
  newTaskInput,
  setNewTaskInput,
}: {
  experimentLaunchChecklist: ChecklistTask[];
  setExperimentLaunchChecklist: (checklist: ChecklistTask[]) => void;
  newTaskInput: ChecklistTask;
  setNewTaskInput: (task: ChecklistTask | undefined) => void;
}) {
  const autoChecklistOptions: AutoChecklistOption[] = [
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
      value: "Add at least 1 tag to this experiment",
      label: "Add at least 1 tag to this experiment",
      propertyKey: "tag",
    },
  ];

  function addNewTask(newTaskInput: ChecklistTask) {
    setExperimentLaunchChecklist([...experimentLaunchChecklist, newTaskInput]);
    setNewTaskInput(undefined);
  }

  return (
    <div className="pt-5 pb-2">
      <h4>New Task</h4>
      <div className="p-3 border rounded">
        <label>Task</label>
        <CreatableSelect
          className="pb-3"
          options={autoChecklistOptions.filter((option) => {
            return !experimentLaunchChecklist.some(
              (index) => index.task === option.value,
            );
          })}
          placeholder="Choose from pre-defined tasks or create your own custom task"
          onChange={(option: AutoChecklistOption) => {
            setNewTaskInput({
              task: option.value,
              completionType: "auto",
              propertyKey: option.propertyKey,
            });
          }}
          onCreateOption={(inputValue) => {
            setNewTaskInput({
              task: inputValue,
              completionType: "manual",
            });
          }}
          noOptionsMessage={() =>
            "No more pre-defined tasks available. Start typing to create a new task"
          }
          value={
            newTaskInput.task
              ? {
                  label: newTaskInput.task,
                  value: newTaskInput.task,
                  propertyKey: newTaskInput.propertyKey,
                }
              : null
          }
          {...ReactSelectProps}
        />
        {newTaskInput.task && newTaskInput.completionType === "manual" ? (
          <Field
            label="Add URL (Optional)"
            autoFocus
            type="url"
            helpText="Add a URL to this task to help your team complete this task."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNewTask(newTaskInput);
              }
            }}
            onChange={(e) => {
              const url = e.target.value.toLowerCase();

              const containsHttp =
                url.startsWith("http://") || url.startsWith("https://");

              setNewTaskInput({
                ...newTaskInput,
                url: containsHttp ? url : "https://" + url,
              });
            }}
          />
        ) : null}
        <div>
          <button
            disabled={!newTaskInput.task}
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              addNewTask(newTaskInput);
            }}
          >
            Add Task
          </button>
          <button
            className="btn btn-link"
            onClick={(e) => {
              e.preventDefault();
              setNewTaskInput(undefined);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
