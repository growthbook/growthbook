import CreatableSelect from "react-select/creatable";
import { ChecklistTask } from "shared/types/experimentLaunchChecklist";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { ReactSelectProps } from "@/components/Forms/SelectField";

type AutoChecklistOption = {
  value: string;
  label: string;
  customFieldId?: string;
  propertyKey?:
    | "hypothesis"
    | "screenshots"
    | "description"
    | "project"
    | "tag"
    | "customField"
    | "prerequisiteTargeting"
    | "schedule";
};

// Prefix https:// when no scheme is present. Only the scheme is lower-cased;
// the rest of the URL keeps its casing since paths/query strings are
// case-sensitive (e.g. Google Drive links). See #6237.
export function normalizeChecklistTaskUrl(rawValue: string): string {
  const match = rawValue.match(/^(https?):\/\//i);
  if (match) {
    return match[1].toLowerCase() + "://" + rawValue.slice(match[0].length);
  }
  return "https://" + rawValue;
}

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
  const { customFields } = useDefinitions();
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
    {
      value: "Ensure prerequisite targeting is set for this experiment",
      label: "Ensure prerequisite targeting is set for this experiment",
      propertyKey: "prerequisiteTargeting",
    },
    {
      value: "Add scheduled start date to experiment",
      label: "Add scheduled start date to experiment",
      propertyKey: "schedule",
    },
  ];

  function addNewTask(newTaskInput: ChecklistTask) {
    setExperimentLaunchChecklist([...experimentLaunchChecklist, newTaskInput]);
    setNewTaskInput(undefined);
  }

  const customChecklistOptions: AutoChecklistOption[] = customFields.map(
    (field) => ({
      value: `Add a value for "${field.name}"`,
      label: `Add a value for "${field.name}"`,
      customFieldId: field.id,
      propertyKey: "customField",
    }),
  );

  const combinedChecklistOptions = [
    ...autoChecklistOptions,
    ...customChecklistOptions,
  ];

  const newTaskValues: AutoChecklistOption | undefined = newTaskInput.task
    ? {
        label: newTaskInput.task,
        value: newTaskInput.task,
        customFieldId: newTaskInput?.customFieldId ?? "",
        propertyKey: newTaskInput.propertyKey ?? undefined,
      }
    : undefined;

  return (
    <div className="pt-5 pb-2">
      <h4>New Task</h4>
      <div className="p-3 border rounded">
        <label>Task</label>
        <CreatableSelect
          className="pb-3"
          classNamePrefix="gb-select"
          options={combinedChecklistOptions.filter((option) => {
            return !experimentLaunchChecklist.some(
              (index) => index.task === option.value,
            );
          })}
          placeholder="Choose from pre-defined tasks or create your own custom task"
          onChange={(option: AutoChecklistOption) => {
            setNewTaskInput({
              task: option.value,
              completionType: "auto",
              customFieldId: option?.customFieldId ?? "",
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
          value={newTaskValues}
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
              setNewTaskInput({
                ...newTaskInput,
                url: normalizeChecklistTaskUrl(e.target.value),
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
            Add To Checklist
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
