import {
  BuiltInChecklistItemKey,
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "shared/types/experimentLaunchChecklist";
import {
  BUILT_IN_CHECKLIST_ITEM_LABELS,
  builtInChecklistItemKeyValidator,
} from "shared/validators";
import { useEffect, useState } from "react";
import { FaPlusCircle } from "react-icons/fa";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import Modal from "@/components/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";
import Link from "@/ui/Link";
import Checkbox from "@/ui/Checkbox";
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
  const [hiddenBuiltInItems, setHiddenBuiltInItems] = useState<
    BuiltInChecklistItemKey[]
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
        body: JSON.stringify({ tasks, hiddenBuiltInItems }),
      });
    } else {
      await apiCall(`/experiments/launch-checklist`, {
        method: "POST",
        body: JSON.stringify({
          tasks,
          projectId: projectParams?.projectId,
          hiddenBuiltInItems,
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
        setHiddenBuiltInItems(data.checklist.hiddenBuiltInItems ?? []);
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
            <Text as="p" weight="medium" mb="1">
              Built-in items
            </Text>
            <Text as="p" size="2" color="gray" mb="2">
              Uncheck any your experiments don&apos;t need. Bandits always
              require all of them, and experiments with Visual Editor changes or
              URL Redirects always require an SDK Connection.
            </Text>
            <Flex direction="column" gap="2" mb="4">
              {builtInChecklistItemKeyValidator.options.map((key) => (
                <Checkbox
                  key={key}
                  label={BUILT_IN_CHECKLIST_ITEM_LABELS[key]}
                  value={!hiddenBuiltInItems.includes(key)}
                  setValue={(shown) =>
                    setHiddenBuiltInItems((prev) =>
                      shown ? prev.filter((k) => k !== key) : [...prev, key],
                    )
                  }
                />
              ))}
            </Flex>
            <Text as="p" weight="medium" mb="1">
              Custom tasks
            </Text>
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
