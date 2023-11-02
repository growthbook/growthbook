import { useState } from "react";
import CreatableSelect from "react-select/creatable";
import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "back-end/types/experimentLaunchChecklist";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Button from "../Button";

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

function ChecklistItem({
  value,
  propertyKey,
  index,
  experimentLaunchChecklist,
  setExperimentLaunchChecklist,
}: {
  value: string;
  index: number;
  propertyKey?:
    | "hypothesis"
    | "screenshots"
    | "description"
    | "project"
    | "tag";
  experimentLaunchChecklist: ChecklistTask[];
  setExperimentLaunchChecklist: (value: ChecklistTask[]) => void;
}) {
  return (
    <div className="d-flex align-items-center py-1">
      <CreatableSelect
        className="w-100"
        isMulti={false}
        options={autoChecklistOptions.filter((option) => {
          return !experimentLaunchChecklist.some(
            (index) => index.task === option.value
          );
        })}
        placeholder="Select a checklist option or create your own"
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
      <Button
        color="link"
        className="m-1"
        onClick={async () => {
          const newChecklist = [...experimentLaunchChecklist];
          newChecklist.splice(index, 1);
          setExperimentLaunchChecklist(newChecklist);
        }}
      >
        Remove
      </Button>
    </div>
  );
}

export default function ExperimentCheckListModal({
  close,
  mutate,
  checklistObj,
}: {
  close: () => void;
  mutate: () => void;
  checklistObj?: ExperimentLaunchChecklistInterface;
}) {
  const { apiCall } = useAuth();
  const [experimentLaunchChecklist, setExperimentLaunchChecklist] = useState<
    ChecklistTask[] | []
  >(checklistObj?.checklist ? checklistObj.checklist : []);

  async function handleSubmit() {
    const checklist = experimentLaunchChecklist;

    if (checklist[checklist.length - 1].task === "") {
      checklist.pop();
    }
    await apiCall(`/experiments/launch-checklist`, {
      method: checklistObj?.id ? "PUT" : "POST",
      body: JSON.stringify({
        checklist,
        id: checklistObj?.id,
      }),
    });
    mutate();
  }

  return (
    <Modal
      open={true}
      close={close}
      size="max"
      header={`${checklistObj?.id ? "Edit" : "Add"} Pre-Launch Checklist`}
      cta="Save"
      submit={() => handleSubmit()}
    >
      <div className="pt-3 pb-5">
        <p>
          Ensure all experiments meet essential criteria before launch by
          customizing your organizations pre-launch checklist. Choose from our
          pre-defined list, or create your own custom launch requirements.
        </p>
        {experimentLaunchChecklist.map((item, i: number) => (
          <ChecklistItem
            key={i}
            value={item.task}
            propertyKey={item.propertyKey}
            index={i}
            experimentLaunchChecklist={experimentLaunchChecklist}
            setExperimentLaunchChecklist={setExperimentLaunchChecklist}
          />
        ))}
        <button
          className="btn btn-outline-primary"
          disabled={
            experimentLaunchChecklist.length > 0 &&
            experimentLaunchChecklist[experimentLaunchChecklist.length - 1]
              .task === ""
          }
          onClick={async (e) => {
            e.preventDefault();
            setExperimentLaunchChecklist([
              ...experimentLaunchChecklist,
              { task: "", completionType: "manual" },
            ]);
          }}
        >
          Add another checklist item
        </button>
      </div>
    </Modal>
  );
}
