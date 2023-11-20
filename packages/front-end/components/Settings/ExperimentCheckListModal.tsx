import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "back-end/types/experimentLaunchChecklist";
import { useEffect, useState } from "react";
import { FaPlus } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import Modal from "../Modal";
import LoadingSpinner from "../LoadingSpinner";
import SortableExperimentChecklist from "./SortableExperimentChecklist";
import ExperimentChecklistEmptyState from "./ExperimentChecklistEmptyState";
import NewExperimentChecklistItem from "./NewExperimentChecklistItem";

export default function ExperimentCheckListModal({
  close,
}: {
  close: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const { data, mutate } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>("/experiments/launch-checklist");

  const checklist = data?.checklist;

  const { apiCall } = useAuth();
  const [experimentLaunchChecklist, setExperimentLaunchChecklist] = useState<
    ChecklistTask[]
  >([]);
  const [newTaskInput, setNewTaskInput] = useState<ChecklistTask | undefined>(
    undefined
  );

  async function handleSubmit() {
    if (!experimentLaunchChecklist) return;

    const tasks = experimentLaunchChecklist.filter((t) => !!t.task);

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

  useEffect(() => {
    if (data) {
      setLoading(false);

      if (data.checklist) {
        setExperimentLaunchChecklist(data.checklist.tasks);
      }
    }
  }, [data]);

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
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <p>
            Customize your organizations experiment pre-launch checklist to
            ensure all experiments meet essential critera before launch. Choose
            from our pre-defined options, or create your own custom launch
            requirements.
          </p>
          <div className="d-flex align-items-center justify-content-between pb-3">
            <h4>Pre-Launch Requirements</h4>
            {experimentLaunchChecklist?.length ? (
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
            {!experimentLaunchChecklist?.length ? (
              <ExperimentChecklistEmptyState
                setNewTaskInput={setNewTaskInput}
              />
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
        </>
      )}
    </Modal>
  );
}
