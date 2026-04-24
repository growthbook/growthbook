import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useForm } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsInput from "@/components/Tags/TagsInput";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import SelectOwner from "@/components/Owner/SelectOwner";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import Text from "@/ui/Text";

export type FocusSelector = "project" | "tags" | "name" | "projects";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  setShowEditInfoModal: (value: boolean) => void;
  mutate: () => void;
  focusSelector?: FocusSelector;
}

export default function EditExperimentInfoModal({
  experiment,
  setShowEditInfoModal,
  mutate,
  focusSelector = "name",
}: Props) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canUpdateExperimentProject = (project) =>
    permissionsUtil.canUpdateExperiment({ project }, {});
  const initialProjectOption = canUpdateExperimentProject("") ? "None" : "";

  const form = useForm({
    defaultValues: {
      name: experiment.name,
      trackingKey: experiment.trackingKey,
      owner: experiment.owner || "",
      tags: experiment.tags,
      project: experiment.project || "",
    },
  });

  return (
    <DialogLayout
      open={true}
      close={() => setShowEditInfoModal(false)}
      trackingEventModalType="edit-experiment-info"
      size="lg"
      trackingEventModalSource="experiment-more-menu"
      header="Edit Info"
      submit={form.handleSubmit(async (data) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      })}
    >
      <Field
        autoFocus={focusSelector === "name"}
        label="Experiment Name"
        labelClassName="font-weight-bold"
        {...form.register("name")}
        required
      />
      <Field
        disabled={experiment.status !== "draft"}
        label="Experiment Key"
        labelClassName="font-weight-bold"
        {...form.register("trackingKey")}
        required
      />
      <SelectOwner
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
      />
      <div className="form-group">
        <Box mb="2">
          <Text weight="semibold">Tags</Text>
        </Box>
        <TagsInput
          autoFocus={focusSelector === "tags"}
          value={form.watch("tags") ?? []}
          onChange={(tags) => form.setValue("tags", tags)}
        />
      </div>
      <SelectField
        label={
          <>
            <Text weight="semibold">Project</Text>
            <Tooltip
              className="pl-1"
              body={
                "The dropdown below has been filtered to only include projects where you have permission to update Experiments"
              }
            />
          </>
        }
        autoFocus={focusSelector === "project"}
        value={form.watch("project")}
        onChange={(v) => form.setValue("project", v)}
        options={useProjectOptions(
          (project) => canUpdateExperimentProject(project),
          experiment.project ? [experiment.project] : [],
        )}
        initialOption={initialProjectOption}
      />
      {experiment.project !== form.watch("project") ? (
        <Callout status="warning">
          Moving to a different Project may prevent your linked Feature Flags,
          Visual Changes, and URL Redirects from being sent to users, and could
          restrict use of some Data Sources and Metrics.
        </Callout>
      ) : null}
    </DialogLayout>
  );
}
