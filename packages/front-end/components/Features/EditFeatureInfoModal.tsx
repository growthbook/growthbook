import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { Box } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import TagsInput from "@/components/Tags/TagsInput";
import SelectOwner from "@/components/Owner/SelectOwner";
import useProjectOptions from "@/hooks/useProjectOptions";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";

const EditFeatureInfoModal: FC<{
  feature: FeatureInterface;
  save: (updates: {
    tags: string[];
    owner: string;
    project: string;
  }) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
  source?: string;
  resourceType: React.ComponentProps<typeof SelectOwner>["resourceType"];
  dependents: number;
}> = ({ feature, save, cancel, mutate, source, resourceType, dependents }) => {
  const form = useForm({
    defaultValues: {
      tags: feature.tags || [],
      owner: feature.owner,
      project: feature.project || "",
    },
  });
  const permissionsUtil = usePermissionsUtil();
  const [showProjectWarningMsg, setShowProjectWarningMsg] = useState(false);
  const { requireProjectForFeatures } = useOrgSettings();

  const permissionRequired = (project) =>
    permissionsUtil.canUpdateFeature(feature, { project });
  const initialOption =
    permissionRequired("") && !requireProjectForFeatures ? "None" : "";

  return (
    <Modal
      trackingEventModalType="edit-feature-info"
      trackingEventModalSource={source}
      header={"Edit Feature Information"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await save(data);
        mutate();
      })}
      cta="Save"
    >
      <Box>
        <Field
          label={"Feature Key"}
          value={feature.id}
          disabled={true}
          helpText={"Feature keys are not editable"}
        />
        <Field
          label={"Feature Type"}
          value={feature.valueType}
          disabled={true}
          helpText={"Feature types cannot be changed"}
        />
        <SelectOwner
          resourceType={resourceType}
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
        <Box mb="4">
          <label>Tags</label>
          <TagsInput
            value={form.watch("tags")}
            onChange={(tags) => form.setValue("tags", tags)}
          />
        </Box>
        <Box mb="4">
          <SelectField
            label="Project"
            value={form.watch("project")}
            onChange={(v) => {
              form.setValue("project", v);
              setShowProjectWarningMsg(v !== feature.project);
            }}
            options={useProjectOptions(
              permissionRequired,
              feature?.project ? [feature.project] : [],
            )}
            initialOption={initialOption}
            autoFocus={true}
            disabled={dependents > 0}
          />
          {dependents > 0 ? (
            <Callout status="warning">
              This feature has{" "}
              {dependents === 1 ? "a dependent feature" : "dependent features"}.
              Projects cannot be changed until{" "}
              {dependents === 1 ? "it has" : "they have"} been removed.
            </Callout>
          ) : (
            <>
              {showProjectWarningMsg && (
                <Callout status="warning">
                  Changing the project may prevent this Feature Flag and any
                  linked Experiments from being sent to users.{" "}
                  <Tooltip
                    body={
                      "SDK endpoints are linked to specific environments and (optionally) projects. Changing the project of this feature may result in this feature returning in a different payload."
                    }
                  />
                </Callout>
              )}
            </>
          )}
        </Box>
      </Box>
    </Modal>
  );
};

export default EditFeatureInfoModal;
