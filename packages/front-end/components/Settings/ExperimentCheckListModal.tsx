import { useState } from "react";
import CreatableSelect from "react-select/creatable";
import { ExperimentLaunchChecklistInterface } from "back-end/types/experimentLaunchChecklist";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Button from "../Button";

const checklistOptions = [
  {
    value: "Experiment must have a hypothesis",
    label: "Experiment must have a hypothesis",
  },
  {
    value: "Upload screenshots of each variation",
    label: "Upload screenshots of each variation",
  },
];

function ChecklistItem({
  value,
  index,
  experimentLaunchChecklist,
  setExperimentLaunchChecklist,
}: {
  value: string;
  index: number;
  experimentLaunchChecklist: string[];
  setExperimentLaunchChecklist: (value: string[]) => void;
}) {
  return (
    <div className="d-flex align-items-center py-1">
      <CreatableSelect
        className="w-100"
        isMulti={false}
        options={checklistOptions.filter((option) => {
          return !experimentLaunchChecklist.includes(option.value);
        })}
        placeholder="Select a checklist option or create your own"
        onChange={(option) => {
          if (!option) return;
          const updatedChecklist = [...experimentLaunchChecklist];
          updatedChecklist[index] = option.value;
          setExperimentLaunchChecklist(updatedChecklist);
        }}
        onCreateOption={(inputValue) => {
          const updatedChecklist = [...experimentLaunchChecklist];
          updatedChecklist[index] = inputValue;
          setExperimentLaunchChecklist(updatedChecklist);
        }}
        value={value ? { label: value, value } : null}
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
    string[] | []
  >(currentChecklist?.checklistItems ? currentChecklist.checklistItems : []);

  async function handleSubmit() {
    const checklist = experimentLaunchChecklist;

    if (checklist[checklist.length - 1] === "") {
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
      header={`${currentChecklist?.id ? "Edit" : "Add"} Experiment Checklist`}
      cta="Save"
      submit={() => handleSubmit()}
    >
      <p>
        Ensure all experiments meet essential criteria before launch by
        customizing your organizations pre-launch checklist.
      </p>
      {experimentLaunchChecklist.map((item, i) => (
        <ChecklistItem
          key={i}
          value={item}
          index={i}
          experimentLaunchChecklist={experimentLaunchChecklist}
          setExperimentLaunchChecklist={setExperimentLaunchChecklist}
        />
      ))}
      <button
        className="btn btn-outline-primary"
        disabled={
          experimentLaunchChecklist[experimentLaunchChecklist.length - 1] === ""
        }
        onClick={async (e) => {
          e.preventDefault();
          setExperimentLaunchChecklist([...experimentLaunchChecklist, ""]);
        }}
      >
        Add another checklist item
      </button>
    </Modal>
  );
}
