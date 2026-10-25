import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useForm } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsInput from "@/components/Tags/TagsInput";
import useProjectOptions from "@/hooks/useProjectOptions";
import useExperimentKeyFieldProps from "@/hooks/useExperimentKeyFieldProps";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import SelectOwner from "@/components/Owner/SelectOwner";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Text from "@/ui/Text";
import RichTextEditor from "@/ui/RichTextEditor";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  filterCustomFieldsForSectionAndProject,
  reconcileCustomFieldValues,
} from "@/services/customFields";

export type InfoSection =
  | "name"
  | "trackingKey"
  | "owner"
  | "tags"
  | "project"
  | "description"
  | "customFields";

export const SECTION_HEADERS: Record<InfoSection, string> = {
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
  section: InfoSection;
  // Narrows the customFields section to this one field.
  customFieldId?: string | null;
}

export default function EditExperimentInfoModal({
  experiment,
  setShowEditInfoModal,
  mutate,
  section,
  customFieldId,
}: Props) {
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

  const shownCustomFields = customFieldId
    ? customFields.filter((f) => f.id === customFieldId)
    : customFields;

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
  const trackingKey = form.watch("trackingKey");
  const trackingKeyFormatProps = useExperimentKeyFieldProps(
    trackingKey,
    trackingKey === experiment.trackingKey,
  );

  return (
    <ModalStandard
      open={true}
      close={() => setShowEditInfoModal(false)}
      trackingEventModalType="edit-experiment-info"
      size={section === "description" ? "lg" : "md"}
      trackingEventModalSource="experiment-more-menu"
      header={
        customFieldId && shownCustomFields.length
          ? `Edit ${shownCustomFields[0].name}`
          : SECTION_HEADERS[section]
      }
      submit={validatedSubmit(form, async (data) => {
        // Only what this section shows: custom fields are rewritten whole, so
        // an unrelated save would drop values outside the project's scope.
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ [section]: data[section] }),
        });
        mutate();
      })}
    >
      {section === "name" ? (
        <Field
          size="legacy"
          autoFocus
          label="Experiment Name"
          {...form.register("name")}
          required
        />
      ) : null}
      {section === "trackingKey" ? (
        <Field
          size="legacy"
          autoFocus
          disabled={experiment.status !== "draft"}
          label="Experiment Key"
          {...form.register("trackingKey")}
          required
          {...trackingKeyFormatProps}
        />
      ) : null}
      {section === "owner" ? (
        <SelectOwner
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
      ) : null}
      {section === "tags" ? (
        <div className="form-group">
          <Box mb="2">
            <Text weight="semibold">Tags</Text>
          </Box>
          <TagsInput
            autoFocus
            value={form.watch("tags") ?? []}
            onChange={(tags) => form.setValue("tags", tags)}
          />
        </div>
      ) : null}
      {section === "project" ? (
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
            autoFocus
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
      {section === "description" ? (
        <Box>
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
      {section === "customFields" && shownCustomFields.length > 0 ? (
        <Box>
          <CustomFieldInput
            fields={shownCustomFields}
            value={form.watch("customFields")}
            onChange={(value) => form.setValue("customFields", value)}
          />
        </Box>
      ) : null}
    </ModalStandard>
  );
}
