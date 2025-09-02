import CreatableSelect from "react-select/creatable";
import { ChecklistTask } from "back-end/types/experimentLaunchChecklist";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { ReactSelectProps } from "@/components/Forms/SelectField";
import MultiSelectField from "../Forms/MultiSelectField";

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
    | "prerequisiteTargeting";
  projects: string[];
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
  const { customFields, projects } = useDefinitions();
  const autoChecklistOptions: AutoChecklistOption[] = [
    {
      value: "Add a descriptive hypothesis for this experiment",
      label: "Add a descriptive hypothesis for this experiment",
      propertyKey: "hypothesis",
      projects: [],
    },
    {
      value: "Upload a screenshot for each variation of the experiment",
      label: "Upload a screenshot for each variation of the experiment",
      propertyKey: "screenshots",
      projects: [],
    },
    {
      value: "Add a description for this experiment",
      label: "Add a description for this experiment",
      propertyKey: "description",
      projects: [],
    },
    {
      value: "Add this experiment to a project",
      label: "Add this experiment to a project",
      propertyKey: "project",
      projects: [],
    },
    {
      value: "Add at least 1 tag to this experiment",
      label: "Add at least 1 tag to this experiment",
      propertyKey: "tag",
      projects: [],
    },
    {
      value: "Ensure prerequisite targeting is set for this experiment",
      label: "Ensure prerequisite targeting is set for this experiment",
      propertyKey: "prerequisiteTargeting",
      projects: [],
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
      projects: [],
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
        projects: newTaskInput.projects ?? [],
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
              projects: option.projects,
            });
          }}
          onCreateOption={(inputValue) => {
            setNewTaskInput({
              task: inputValue,
              completionType: "manual",
              projects: [],
            });
          }}
          noOptionsMessage={() =>
            "No more pre-defined tasks available. Start typing to create a new task"
          }
          value={newTaskValues}
          {...ReactSelectProps}
        />
        <MultiSelectField
          label="Projects"
          placeholder="All Projects"
          value={newTaskInput.projects}
          onChange={(projects) =>
            setNewTaskInput({ ...newTaskInput, projects })
          }
          helpText="Limit this task to specific projects. If left blank, the task will be available to all projects."
          options={projects.map((project) => ({
            label: project.name,
            value: project.id,
          }))}
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
