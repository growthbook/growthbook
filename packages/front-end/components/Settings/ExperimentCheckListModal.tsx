import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "back-end/types/experimentLaunchChecklist";
import { useState } from "react";
import { FaPlus } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import SortableExperimentChecklist from "./SortableExperimentChecklist";
import ExperimentChecklistEmptyState from "./ExperimentChecklistEmptyState";
import NewExperimentChecklistItem from "./NewExperimentChecklistItem";

export default function ExperimentCheckListModal2({
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
  >(checklist?.tasks ? checklist.tasks : []);
  const [newTaskInput, setNewTaskInput] = useState<ChecklistTask | undefined>(
    undefined
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
      <p>
        Customize your organizations experiment pre-launch checklist to ensure
        all experiments meet essential critera before launch. Choose from our
        pre-defined options, or create your own custom launch requirements.
      </p>
      <div className="d-flex align-items-center justify-content-between pb-3">
        <h4>Pre-Launch Requirements</h4>
        {experimentLaunchChecklist.length ? (
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setNewTaskInput({ task: "", completionType: "manual" });
            }}
          >
            <FaPlus className="mr-2" />
            Add Task
          </button>
        ) : null}
      </div>
      <div>
        {!experimentLaunchChecklist.length ? (
          <ExperimentChecklistEmptyState setNewTaskInput={setNewTaskInput} />
        ) : (
          <SortableExperimentChecklist
            experimentLaunchChecklist={experimentLaunchChecklist}
            setExperimentLaunchChecklist={setExperimentLaunchChecklist}
          />
        )}
      </div>
      {newTaskInput ? (
        <NewExperimentChecklistItem
          experimentLaunchChecklist={experimentLaunchChecklist}
          setExperimentLaunchChecklist={setExperimentLaunchChecklist}
          newTaskInput={newTaskInput}
          setNewTaskInput={setNewTaskInput}
        />
      ) : null}
    </Modal>
  );
}
