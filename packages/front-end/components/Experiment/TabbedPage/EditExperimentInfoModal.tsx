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
import { getExperimentDescriptionPlaceholder } from "@/components/Experiment/TabbedPage/DescriptionField";

export type FocusSelector = "project" | "tags" | "name" | "projects";

/** Which of the experiment's details the modal edits; all of them by default. */
export type InfoSection = "all" | "general" | "description" | "customFields";

const SECTION_HEADERS: Record<InfoSection, string> = {
  all: "Edit Info",
  general: "Edit Details",
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
      size="lg"
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
      {shows("general") ? (
        <>
          <Field
            size="legacy"
            autoFocus={focusSelector === "name"}
            label="Experiment Name"
            {...form.register("name")}
            required
          />
          <Field
            size="legacy"
            disabled={experiment.status !== "draft"}
            label="Experiment Key"
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
            autoFocus={focusSelector === "project"}
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
            placeholder={getExperimentDescriptionPlaceholder(
              experiment.type ?? "standard",
            )}
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
