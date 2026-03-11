import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { Box } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import TagsInput from "@/components/Tags/TagsInput";
import SelectOwner from "@/components/Owner/SelectOwner";
import useProjectOptions from "@/hooks/useProjectOptions";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DraftRevisionCallout from "@/components/Features/DraftRevisionCallout";
import Tooltip from "@/components/Tooltip/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import MarkdownInput from "@/components/Markdown/MarkdownInput";

const EditFeatureInfoModal: FC<{
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  save: (updates: {
    tags: string[];
    owner: string;
    project: string;
    description: string;
  }) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
  source?: string;
  dependents: number;
}> = ({ feature, revisionList, save, cancel, mutate, source, dependents }) => {
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const [showProjectWarningMsg, setShowProjectWarningMsg] = useState(false);
  const { requireProjectForFeatures } = settings;

  // Determine whether metadata changes require a draft/approval for this feature
  const requireReviewSettings = settings?.requireReviews;
  const metadataReviewRequired = useMemo(() => {
    if (!requireReviewSettings || typeof requireReviewSettings === "boolean") {
      return false;
    }
    const reviewSetting = getReviewSetting(requireReviewSettings, feature);
    return !!(reviewSetting?.requireReviewOn);
  }, [requireReviewSettings, feature]);

  // Find an active draft (there can be multiple)
  const activeDraft = useMemo(
    () =>
      revisionList
        .filter((r) =>
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
        )
        .sort((a, b) => b.version - a.version)[0] ?? null,
    [revisionList],
  );

  const form = useForm({
    defaultValues: {
      tags: feature.tags || [],
      owner: feature.owner,
      project: feature.project || "",
      description: feature.description || "",
    },
  });

  const permissionRequired = (project) =>
    permissionsUtil.canUpdateFeature(feature, { project });
  const initialOption =
    permissionRequired("") && !requireProjectForFeatures ? "None" : "";

  return (
    <Modal
      trackingEventModalType="edit-feature-info"
      trackingEventModalSource={source}
      header="Edit Feature Information"
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await save(data);
        mutate();
      })}
      cta={metadataReviewRequired ? "Save to Draft" : "Save"}
      useRadixButton={true}
      size="lg"
    >
      <Box>
        {metadataReviewRequired && (
          <DraftRevisionCallout activeDraft={activeDraft} />
        )}

        <Field
          label="Feature Key"
          value={feature.id}
          disabled={true}
          helpText="Feature keys are not editable"
        />
        <Field
          label="Feature Type"
          value={feature.valueType}
          disabled={true}
          helpText="Feature types cannot be changed"
        />
        <Box mb="4">
          <Text as="label" weight="medium" size="small">
            Description
          </Text>
          <Box mt="1">
            <MarkdownInput
              value={form.watch("description")}
              setValue={(v) => form.setValue("description", v)}
              placeholder="Short human-readable description"
              showButtons={false}
              hidePreview={false}
            />
          </Box>
        </Box>
        <SelectOwner
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
                  <Tooltip body="SDK endpoints are linked to specific environments and (optionally) projects. Changing the project of this feature may result in this feature returning in a different payload." />
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
