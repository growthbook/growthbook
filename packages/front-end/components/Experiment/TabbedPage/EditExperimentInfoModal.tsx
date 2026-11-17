import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { useForm } from "react-hook-form";
import { isEqual } from "lodash";
import { Box } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsInput from "@/components/Tags/TagsInput";
import useProjectOptions from "@/hooks/useProjectOptions";
import useExperimentKeyFieldProps from "@/hooks/useExperimentKeyFieldProps";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import MultiSelectField from "@/ui/MultiSelectField";
import { useAuth } from "@/services/auth";
import SelectOwner from "@/components/Owner/SelectOwner";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Text from "@/ui/Text";
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
  | "customFields";

export const SECTION_HEADERS: Record<InfoSection, string> = {
  name: "Edit Name",
  trackingKey: "Edit Experiment Key",
  owner: "Edit Owner",
  tags: "Edit Tags",
  project: "Edit Project",
  customFields: "Edit Additional Fields",
};

interface Props {
  experiment: ExperimentInterfaceStringDates;
  // A holdout's name lives on both it and its experiment, its projects on it.
  holdout?: HoldoutInterfaceStringDates;
  setShowEditInfoModal: (value: boolean) => void;
  mutate: () => void;
  section: InfoSection;
  // Narrows the customFields section to this one field.
  customFieldId?: string | null;
}

export default function EditExperimentInfoModal({
  experiment,
  holdout,
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
  const holdoutProjectOptions = useProjectOptions(
    (project) =>
      !!holdout &&
      permissionsUtil.canUpdateHoldout(holdout, { projects: [project] }),
    holdout?.projects ?? [],
  );

  const form = useForm({
    defaultValues: {
      name: experiment.name,
      trackingKey: experiment.trackingKey,
      owner: experiment.owner || "",
      tags: experiment.tags,
      project: experiment.project || "",
      projects: holdout?.projects ?? [],
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
      size="md"
      trackingEventModalSource="experiment-more-menu"
      header={
        customFieldId && shownCustomFields.length
          ? `Edit ${shownCustomFields[0].name}`
          : holdout && section === "project"
            ? "Edit Projects"
            : SECTION_HEADERS[section]
      }
      submit={validatedSubmit(form, async (data) => {
        if (holdout && section === "project") {
          await apiCall(`/holdout/${holdout.id}`, {
            method: "PUT",
            body: JSON.stringify({ projects: data.projects }),
          });
        } else {
          // Only what this section shows: custom fields are rewritten whole,
          // so an unrelated save would drop values outside the project's scope.
          await apiCall(`/experiment/${experiment.id}`, {
            method: "POST",
            body: JSON.stringify({ [section]: data[section] }),
          });
          // The holdouts list and breadcrumbs read the holdout's own name.
          if (holdout && section === "name") {
            await apiCall(`/holdout/${holdout.id}`, {
              method: "PUT",
              body: JSON.stringify({ name: data.name }),
            });
          }
        }
        mutate();
      })}
    >
      {section === "name" ? (
        <Field
          size="legacy"
          autoFocus
          label={holdout ? "Holdout name" : "Experiment name"}
          {...form.register("name")}
          required
        />
      ) : null}
      {section === "trackingKey" ? (
        <Field
          size="legacy"
          autoFocus
          disabled={experiment.status !== "draft"}
          label="Experiment key"
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
      {section === "project" && holdout ? (
        <>
          <MultiSelectField
            legacyHeight
            label={
              <>
                <Text weight="semibold">Projects</Text>
                <Tooltip
                  className="pl-1"
                  body="The dropdown below has been filtered to only include projects where you have permission to update Holdouts"
                />
              </>
            }
            placeholder="All Projects"
            value={form.watch("projects")}
            options={holdoutProjectOptions}
            onChange={(v) => form.setValue("projects", v)}
            customClassName="label-overflow-ellipsis"
          />
          {!isEqual(form.watch("projects"), holdout.projects) ? (
            <Callout status="warning">
              Changing projects could restrict use of some Data Sources and
              Metrics.
            </Callout>
          ) : null}
        </>
      ) : section === "project" ? (
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
      {section === "customFields" && shownCustomFields.length > 0 ? (
        <CustomFieldInput
          fields={shownCustomFields}
          value={form.watch("customFields")}
          onChange={(value) => form.setValue("customFields", value)}
        />
      ) : null}
    </ModalStandard>
  );
}
