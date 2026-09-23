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
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import RichTextEditor from "@/ui/RichTextEditor";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  filterCustomFieldsForSectionAndProject,
  reconcileCustomFieldValues,
} from "@/services/customFields";

export type FocusSelector = "project" | "tags" | "name" | "projects";

/**
 * Which of the experiment's details the modal edits. One field makes a quick,
 * narrow editor; custom fields are edited as a block.
 */
export type InfoSection =
  | "all"
  | "name"
  | "trackingKey"
  | "owner"
  | "tags"
  | "project"
  | "description"
  | "customFields";

const SECTION_HEADERS: Record<InfoSection, string> = {
  all: "Edit Info",
  name: "Edit Name",
  trackingKey: "Edit Experiment Key",
  owner: "Edit Owner",
  tags: "Edit Tags",
  project: "Edit Project",
  description: "Edit Description",
  customFields: "Edit Additional Fields",
};

interface Props {
  experiment: ExperimentInterfaceStringDates;
  setShowEditInfoModal: (value: boolean) => void;
  mutate: () => void;
  focusSelector?: FocusSelector;
  section?: InfoSection;
}

export default function EditExperimentInfoModal({
  experiment,
  setShowEditInfoModal,
  mutate,
  focusSelector = "name",
  section = "all",
}: Props) {
  const shows = (part: Exclude<InfoSection, "all">) =>
    section === "all" || section === part;
  const focus: InfoSection | FocusSelector =
    section === "all" ? focusSelector : section;
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canUpdateExperimentProject = (project) =>
    permissionsUtil.canUpdateExperiment({ project }, {});
  const initialProjectOption = canUpdateExperimentProject("") ? "None" : "";

  const customFields =
    filterCustomFieldsForSectionAndProject(
      useCustomFields(),
      "experiment",
      experiment.project,
    ) ?? [];

  const projectOptions = useProjectOptions(
    (project) => canUpdateExperimentProject(project),
    experiment.project ? [experiment.project] : [],
  );

  const form = useForm({
    defaultValues: {
      name: experiment.name,
      trackingKey: experiment.trackingKey,
      owner: experiment.owner || "",
      tags: experiment.tags,
      project: experiment.project || "",
      description: experiment.description || "",
      customFields: reconcileCustomFieldValues(
        customFields,
        experiment.customFields,
        false,
      ),
    },
  });

  return (
    <ModalStandard
      open={true}
      close={() => setShowEditInfoModal(false)}
      trackingEventModalType="edit-experiment-info"
      size={section === "all" || section === "description" ? "lg" : "md"}
      trackingEventModalSource="experiment-more-menu"
      header={SECTION_HEADERS[section]}
      submit={form.handleSubmit(async (data) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      })}
    >
      {shows("name") ? (
        <Field
          size="legacy"
          autoFocus={focus === "name"}
          label="Experiment Name"
          {...form.register("name")}
          required
        />
      ) : null}
      {shows("trackingKey") ? (
        <Field
          size="legacy"
          autoFocus={focus === "trackingKey"}
          disabled={experiment.status !== "draft"}
          label="Experiment Key"
          {...form.register("trackingKey")}
          required
        />
      ) : null}
      {shows("owner") ? (
        <SelectOwner
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
      ) : null}
      {shows("tags") ? (
        <div className="form-group">
          <Box mb="2">
            <Text weight="semibold">Tags</Text>
          </Box>
          <TagsInput
            autoFocus={focus === "tags"}
            value={form.watch("tags") ?? []}
            onChange={(tags) => form.setValue("tags", tags)}
          />
        </div>
      ) : null}
      {shows("project") ? (
        <>
          <SelectField
            size="legacy"
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
            autoFocus={focus === "project"}
            value={form.watch("project")}
            onChange={(v) => form.setValue("project", v)}
            options={projectOptions}
            initialOption={initialProjectOption}
          />
          {(experiment.project || "") !== form.watch("project") ? (
            <Callout status="warning">
              Moving to a different Project may prevent your linked Feature
              Flags, Visual Changes, and URL Redirects from being sent to users,
              and could restrict use of some Data Sources and Metrics.
            </Callout>
          ) : null}
        </>
      ) : null}
      {shows("description") ? (
        <Box mt={section === "description" ? "0" : "4"}>
          <Box mb="2">
            <Text weight="semibold">Description</Text>
          </Box>
          <RichTextEditor
            value={form.watch("description")}
            onChange={(description) =>
              form.setValue("description", description)
            }
            height="md"
            autoGrow
          />
        </Box>
      ) : null}
      {shows("customFields") && customFields.length > 0 ? (
        <Box mt={section === "customFields" ? "0" : "4"}>
          <CustomFieldInput
            fields={customFields}
            value={form.watch("customFields")}
            onChange={(value) => form.setValue("customFields", value)}
          />
        </Box>
      ) : null}
    </ModalStandard>
  );
}
