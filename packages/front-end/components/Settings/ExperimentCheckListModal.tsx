import { useState } from "react";
import CreatableSelect from "react-select/creatable";
import {
  ChecklistItem,
  ExperimentLaunchChecklistInterface,
} from "back-end/types/experimentLaunchChecklist";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Button from "../Button";

type ChecklistOptions = {
  //TODO: Rename this
  value: string;
  label: string;
  statusKey: "hypothesis" | "screenshots" | "description" | "project" | "tag";
};

const checklistOptions: ChecklistOptions[] = [
  {
    value: "Add a descriptive hypothesis for this experiment",
    label: "Add a descriptive hypothesis for this experiment",
    statusKey: "hypothesis",
  },
  {
    value: "Upload a screenshot for each variation of the experiment",
    label: "Upload a screenshot for each variation of the experiment",
    statusKey: "screenshots",
  },
  {
    value: "Add a description for this experiment",
    label: "Add a description for this experiment",
    statusKey: "description",
  },
  {
    value: "Add this experiment to a project",
    label: "Add this experiment to a project",
    statusKey: "project",
  },
  {
    value: "Add atleast 1 tag to this experiment",
    label: "Add atleast 1 tag to this experiment",
    statusKey: "tag",
  },
];

function ChecklistItem({
  value,
  statusKey,
  index,
  experimentLaunchChecklist,
  setExperimentLaunchChecklist,
}: {
  value: string;
  index: number;
  statusKey?: "hypothesis" | "screenshots" | "description" | "project" | "tag";
  experimentLaunchChecklist: ChecklistItem[];
  setExperimentLaunchChecklist: (value: ChecklistItem[]) => void;
}) {
  return (
    <div className="d-flex align-items-center py-1">
      <CreatableSelect
        className="w-100"
        isMulti={false}
        options={checklistOptions.filter((option) => {
          return !experimentLaunchChecklist.some(
            (index) => index.item === option.value
          );
        })}
        placeholder="Select a checklist option or create your own"
        onChange={(option: ChecklistOptions) => {
          if (!option) return;
          const updatedChecklist = [...experimentLaunchChecklist];
          updatedChecklist[index].item = option.value;
          updatedChecklist[index].type = "auto";
          updatedChecklist[index].statusKey = option.statusKey;
          setExperimentLaunchChecklist(updatedChecklist);
        }}
        onCreateOption={(inputValue) => {
          const updatedChecklist = [...experimentLaunchChecklist];
          updatedChecklist[index].item = inputValue;
          updatedChecklist[index].type = "manual";
          setExperimentLaunchChecklist(updatedChecklist);
        }}
        value={value ? { label: value, value, statusKey } : null}
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
  currentChecklist,
  mutate,
}: {
  close: () => void;
  currentChecklist: ExperimentLaunchChecklistInterface | null;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [experimentLaunchChecklist, setExperimentLaunchChecklist] = useState<
    ChecklistItem[] | []
  >(currentChecklist?.checklistItems ? currentChecklist.checklistItems : []);

  async function handleSubmit() {
    const checklist = experimentLaunchChecklist;

    if (checklist[checklist.length - 1].item === "") {
      checklist.pop();
    }
    await apiCall(`/experiments/launch-checklist`, {
      method: currentChecklist?.id ? "PUT" : "POST",
      body: JSON.stringify({
        checklist,
        id: currentChecklist?.id,
      }),
    });
    mutate();
  }

  return (
    <Modal
      open={true}
      close={close}
      size="max"
      header={`${currentChecklist?.id ? "Edit" : "Add"} Pre-Launch Checklist`}
      cta="Save"
      submit={() => handleSubmit()}
    >
      <div className="pt-3 pb-5">
        <p>
          Ensure all experiments meet essential criteria before launch by
          customizing your organizations pre-launch checklist. Choose from our
          pre-defined list, or create your own custom launch requirements.
        </p>
        {experimentLaunchChecklist.map((item, i) => (
          <ChecklistItem
            key={i}
            value={item.item}
            statusKey={item.statusKey}
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
              .item === ""
          }
          onClick={async (e) => {
            e.preventDefault();
            setExperimentLaunchChecklist([
              ...experimentLaunchChecklist,
              { item: "", type: "manual" },
            ]);
          }}
        >
          Add another checklist item
        </button>
      </div>
    </Modal>
  );
}
