import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsInput from "@/components/Tags/TagsInput";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import SelectOwner from "@/components/Owner/SelectOwner";
import Dialog from "@/ui/Dialog";

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
    // <Modal
    //   open={true}
    //   close={() => setShowEditInfoModal(false)}
    //   trackingEventModalType="edit-experiment-info"
    //   size="lg"
    //   trackingEventModalSource="experiment-more-menu"
    //   // if this is undefined, the Modal component sets the value to the first enabled input field
    //   autoFocusSelector=""
    //   header="Edit Info"
    <Dialog
      open
      size="lg"
      header="Edit Info"
      trackingEventModalType="edit-experiment-info"
      trackingEventModalSource="experiment-more-menu"
      close={() => setShowEditInfoModal(false)}
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
        {...form.register("name")}
        required
      />
      <Field
        disabled={experiment.status !== "draft"}
        label="Experiment Key"
        {...form.register("trackingKey")}
        required
      />
      <SelectOwner
        resourceType="experiment"
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
      />
      <div className="form-group">
        <label className="font-weight-bold">Tags</label>
        <TagsInput
          autoFocus={focusSelector === "tags"}
          value={form.watch("tags") ?? []}
          onChange={(tags) => form.setValue("tags", tags)}
        />
      </div>
      <SelectField
        label={
          <>
            Project
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
      {/* </Modal> */}
    </Dialog>
  );
}
