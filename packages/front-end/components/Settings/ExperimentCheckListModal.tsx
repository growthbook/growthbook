import { useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import CreatableSelect from "react-select/creatable";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Button from "../Button";

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
  console.log("value", value);
  return (
    <div className="d-flex align-items-center py-1">
      <CreatableSelect
        className="w-100"
        isMulti={false}
        placeholder="Select a checklist option or create your own"
        onCreateOption={(inputValue) => {
          console.log("inputValue", inputValue);
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
  org,
  close,
}: {
  org: Partial<OrganizationInterface>;
  close: () => void;
}) {
  const [experimentLaunchChecklist, setExperimentLaunchChecklist] = useState<
    string[]
  >(() => org.settings?.experimentLaunchChecklist || []);
  const { apiCall } = useAuth();

  async function handleSubmit() {
    const settings = {
      experimentLaunchChecklist,
    };
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings,
      }),
    });
  }
  return (
    <Modal
      open={true}
      close={close}
      header={"Edit Experiment Checklist"}
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
