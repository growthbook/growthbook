import { useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";

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

  console.log("org", org);

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
      <h1>Hi</h1>
      <p>Info about this goes here</p>
      {experimentLaunchChecklist.map((item, i) => (
        <div key={i}>{item}</div>
      ))}
      <button
        onClick={(e) => {
          e.preventDefault();
          setExperimentLaunchChecklist([
            ...experimentLaunchChecklist,
            "Another one 1",
          ]);
        }}
      >
        Add another item
      </button>
    </Modal>
  );
}
