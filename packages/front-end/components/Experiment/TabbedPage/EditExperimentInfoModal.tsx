import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Text } from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import metaDataStyles from "@/components/Radix/Styles/Metadata.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";
import useMembers from "@/hooks/useMembers";
import TagsInput from "@/components/Tags/TagsInput";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/components/Radix/Callout";
import { useAuth } from "@/services/auth";
import UserAvatar from "@/components/Avatar/UserAvatar";

export type FocusSelector = "project" | "tags" | "name";

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
  const { memberUserNameAndIdOptions } = useMembers();
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
    <Modal
      open={true}
      close={() => setShowEditInfoModal(false)}
      trackingEventModalType="edit-experiment-info"
      size="lg"
      trackingEventModalSource="experiment-more-menu"
      // if this is undefined, the Modal component sets the value to the first enabled input field
      autoFocusSelector=""
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
        {...form.register("name")}
        required
      />
      <Field
        disabled={experiment.status !== "draft"}
        label="Experiment Key"
        {...form.register("trackingKey")}
        required
      />
      <SelectField
        label="Owner"
        options={memberUserNameAndIdOptions.map((member) => {
          return { label: member.display, value: member.value };
        })}
        value={form.watch("owner")}
        comboBox
        onChange={(v) => form.setValue("owner", v)}
        formatOptionLabel={({ label }) => {
          return (
            <>
              <span>
                {label !== "" && (
                  <UserAvatar name={label} size="sm" variant="soft" />
                )}
                <Text
                  weight="regular"
                  className={metaDataStyles.valueColor}
                  ml="1"
                >
                  {label === "" ? "None" : label}
                </Text>
              </span>
            </>
          );
        }}
      />
      <div className="form-group">
        <label>Tags</label>
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
