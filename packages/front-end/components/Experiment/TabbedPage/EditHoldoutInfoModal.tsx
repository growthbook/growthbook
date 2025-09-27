import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { isEqual } from "lodash";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsInput from "@/components/Tags/TagsInput";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import SelectOwner from "@/components/Owner/SelectOwner";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { FocusSelector } from "./EditExperimentInfoModal";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout: HoldoutInterface;
  setShowEditInfoModal: (value: boolean) => void;
  mutate: () => void;
  focusSelector?: FocusSelector;
}

export default function EditHoldoutInfoModal({
  experiment,
  holdout,
  setShowEditInfoModal,
  mutate,
  focusSelector = "name",
}: Props) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canUpdateHoldoutProjects = (project) =>
    permissionsUtil.canUpdateHoldout({ projects: [project] }, { projects: [] });

  const form = useForm({
    defaultValues: {
      name: holdout.name,
      owner: experiment.owner || "",
      tags: experiment.tags,
      projects: holdout.projects || [],
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
        const { projects, name, ...experimentData } = data;

        await apiCall(`/experiment/${holdout.experimentId}`, {
          method: "POST",
          body: JSON.stringify({ name, ...experimentData }),
        });
        await apiCall(`/holdout/${holdout.id}`, {
          method: "PUT",
          body: JSON.stringify({ name, projects }),
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
      <SelectOwner
        resourceType="experiment"
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
      />
      <div className="form-group">
        <label>Tags</label>
        <TagsInput
          autoFocus={focusSelector === "tags"}
          value={form.watch("tags") ?? []}
          onChange={(tags) => form.setValue("tags", tags)}
        />
      </div>
      <MultiSelectField
        label={
          <>
            Projects
            <Tooltip
              className="pl-1"
              body={
                "The dropdown below has been filtered to only include projects where you have permission to update Holdouts"
              }
            />
          </>
        }
        placeholder="All projects"
        autoFocus={focusSelector === "projects"}
        value={form.watch("projects") || []}
        options={useProjectOptions(
          (project) => canUpdateHoldoutProjects(project),
          experiment.project ? [experiment.project] : [],
        )}
        onChange={(v) => form.setValue("projects", v)}
        customClassName="label-overflow-ellipsis"
        helpText="Assign this holdout to specific projects"
      />
      {!isEqual(form.watch("projects"), holdout.projects) ? (
        <Callout status="warning">
          Changing projects could restrict use of some Data Sources and Metrics.
        </Callout>
      ) : null}
    </Modal>
  );
}
