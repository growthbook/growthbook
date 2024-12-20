import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import useMembers from "@/hooks/useMembers";
import TagsInput from "@/components/Tags/TagsInput";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/components/Radix/Callout";
import { useAuth } from "@/services/auth";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  setShowEditInfoModal: (value: boolean) => void;
  mutate: () => void;
}

export default function EditExperimentInfoModal({
  experiment,
  setShowEditInfoModal,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const { memberUserNameAndIdOptions } = useMembers();
  const permissionsUtil = usePermissionsUtil();
  const canUpdateProjects = (project) =>
    permissionsUtil.canUpdateExperiment({ project }, {});
  const initialProjectOption = canUpdateProjects("") ? "None" : "";

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
    <Modal
      open={true}
      close={() => setShowEditInfoModal(false)}
      trackingEventModalType="edit-experiment-info"
      size="lg"
      trackingEventModalSource="experiment-more-menu"
      header="Edit Info"
      //MKTODO: Do I need to do any advanced logic to only pass in fields the user actually changed?
      submit={form.handleSubmit(async (data) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      })}
    >
      <Field label="Experiment Name" {...form.register("name")} required />
      <Field
        disabled={experiment.status !== "draft"}
        label="Experiment Key"
        {...form.register("trackingKey")}
        required
      />
      {/* MKTODO: Update the design here */}
      <SelectField
        label="Owner"
        options={memberUserNameAndIdOptions.map((member) => {
          return { label: member.display, value: member.value };
        })}
        value={form.watch("owner")}
        comboBox
        onChange={(v) => form.setValue("owner", v)}
      />
      {/* MKTODO: Update the design here */}
      <div className="form-group">
        <label>Tags</label>
        <TagsInput
          value={form.watch("tags") ?? []}
          onChange={(tags) => form.setValue("tags", tags)}
        />
      </div>
      <SelectField
        label={
          <>
            Projects{" "}
            <Tooltip
              body={
                "The dropdown below has been filtered to only include projects where you have permission to update Experiments"
              }
            />
          </>
        }
        value={form.watch("project")}
        onChange={(v) => form.setValue("project", v)}
        //MKTODO: Validate this permission logic
        options={useProjectOptions(
          (project) => canUpdateProjects(project),
          experiment.project ? [experiment.project] : []
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
    </Modal>
  );
}
