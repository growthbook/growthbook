import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "back-end/types/experimentLaunchChecklist";
import { useEffect, useState } from "react";
import { FaPlus } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import Modal from "@/components/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "../Radix/Button";
import Tooltip from "../Tooltip/Tooltip";
import SortableExperimentChecklist from "./SortableExperimentChecklist";
import ExperimentChecklistEmptyState from "./ExperimentChecklistEmptyState";
import NewExperimentChecklistItem from "./NewExperimentChecklistItem";

type ProjectParams = {
  projectId: string;
  projectName: string;
};

export default function ExperimentCheckListModal({
  close,
  projectParams,
}: {
  close: () => void;
  projectParams?: ProjectParams;
}) {
  const [loading, setLoading] = useState(true);
  const { data, mutate } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>(
    `/experiments/launch-checklist?projectId=${projectParams?.projectId || ""}`,
  );

  const checklist = data?.checklist;

  const { apiCall } = useAuth();
  const [experimentLaunchChecklist, setExperimentLaunchChecklist] = useState<
    ChecklistTask[]
  >([]);
  const [newTaskInput, setNewTaskInput] = useState<ChecklistTask | undefined>(
    undefined,
  );

  async function handleDelete() {
    await apiCall(`/experiments/launch-checklist/${checklist?.id}`, {
      method: "DELETE",
    });
    mutate();
    close();
  }

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
        body: JSON.stringify({ tasks, projectId: projectParams?.projectId }),
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
      trackingEventModalType=""
      open={true}
      close={close}
      size="max"
      backCTA={
        projectParams?.projectId && checklist?.id ? (
          <>
            <Tooltip body="If you delete this checklist, all experiments in this project will revert to using your organization's default Pre-Launch Checklist">
              <Button
                variant="ghost"
                color="red"
                onClick={() => handleDelete()}
              >
                Delete Checklist
              </Button>
            </Tooltip>
          </>
        ) : null
      }
      header={`${
        checklist?.id ? "Edit" : "Add"
      } Experiment Pre-Launch Checklist ${projectParams?.projectName ? `for ${projectParams.projectName}` : ""}`}
      cta="Save"
      submit={() => handleSubmit()}
    >
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <p>
            {`Customize your ${projectParams?.projectName ? `project's` : `organization's`} experiment pre-launch checklist to
            ensure all experiments meet essential critera before launch. Choose
            from our pre-defined options, or create your own custom launch
            requirements.`}
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
