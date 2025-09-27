import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "back-end/types/experimentLaunchChecklist";
import { useEffect, useState } from "react";
import { FaPlusCircle } from "react-icons/fa";
import { Box, Heading, Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import Modal from "@/components/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";
import Link from "@/ui/Link";
import SortableExperimentChecklist from "./SortableExperimentChecklist";
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
      showHeaderCloseButton={false}
      header={null}
      cta="Confirm"
      submit={() => handleSubmit()}
    >
      {loading ? (
        <LoadingSpinner />
      ) : (
        <Box mx="2">
          <Heading as="h4" size="4">
            {checklist?.id ? "Edit" : "Add"} Experiment Pre-Launch Checklist
            {projectParams?.projectName
              ? ` for ${projectParams.projectName}`
              : ""}
          </Heading>
          <Text as="p">
            {`Customize the tasks required to complete prior to running an experiment. Checklist items will ${projectParams?.projectName ? "only apply to experiments in this project." : "apply across all experiments in your organization, unless overridden by a Project-specific checklist."}`}
          </Text>
          <Box m="4" mt="6" mb="6">
            <div className="d-flex align-items-center justify-content-between pb-1">
              <h4>Pre-Launch Requirements</h4>
            </div>
            <Box mb="2">
              {!experimentLaunchChecklist?.length ? (
                <Text as="span" className="text-muted font-italic">
                  No tasks have been added yet.
                </Text>
              ) : (
                <SortableExperimentChecklist
                  experimentLaunchChecklist={experimentLaunchChecklist}
                  setExperimentLaunchChecklist={setExperimentLaunchChecklist}
                />
              )}
            </Box>
            <Link
              href="#"
              onClick={() =>
                setNewTaskInput({ task: "", completionType: "manual" })
              }
            >
              <FaPlusCircle className="mr-2" />
              <Text weight="medium">Add Task</Text>
            </Link>
            {newTaskInput ? (
              <NewExperimentChecklistItem
                experimentLaunchChecklist={experimentLaunchChecklist}
                setExperimentLaunchChecklist={setExperimentLaunchChecklist}
                newTaskInput={newTaskInput}
                setNewTaskInput={setNewTaskInput}
              />
            ) : null}
          </Box>
        </Box>
      )}
    </Modal>
  );
}
