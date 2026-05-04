import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
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
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useAuth } from "@/services/auth";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";

const EditFeatureInfoModal: FC<{
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  cancel: () => void;
  mutate: () => void;
  setVersion?: (v: number) => void;
  source?: string;
  dependents: number;
}> = ({
  feature,
  revisionList,
  cancel,
  mutate,
  setVersion,
  source,
  dependents,
}) => {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const [showProjectWarningMsg, setShowProjectWarningMsg] = useState(false);
  const { requireProjectForFeatures } = settings;

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);

  // Gated when requireReviewOn is true and featureRequireMetadataReview is not disabled
  const metadataGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return false;
    return reviewSetting.featureRequireMetadataReview !== false;
  })();

  const canAutoPublish = isAdmin || !metadataGated;

  const defaultDraft = useDefaultDraft(revisionList);

  const [mode, setMode] = useState<DraftMode>(
    metadataGated ? "new" : "publish",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
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
        const res = await apiCall<{ draftVersion?: number }>(
          `/feature/${feature.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              ...data,
              ...(mode === "publish"
                ? { autoPublish: true }
                : mode === "existing"
                  ? { targetDraftVersion: selectedDraft }
                  : { forceNewDraft: true }),
            }),
          },
        );
        mutate();
        const resolvedVersion =
          res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
        if (resolvedVersion != null && setVersion) setVersion(resolvedVersion);
      })}
      cta={mode === "publish" ? "Save" : "Save to draft"}
      ctaEnabled={form.formState.isDirty}
      useRadixButton={true}
      size="lg"
    >
      <Box>
        <DraftSelectorForChanges
          feature={feature}
          revisionList={revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={canAutoPublish}
          gatedEnvSet={metadataGated ? "all" : "none"}
        />
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
        <SelectOwner
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v, { shouldDirty: true })}
        />
        <Box mb="4">
          <SelectField
            label="Project"
            value={form.watch("project")}
            onChange={(v) => {
              form.setValue("project", v, { shouldDirty: true });
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
                  Changing the project may prevent this Feature and any linked
                  Experiments from being sent to users.{" "}
                  <Tooltip body="SDK endpoints are linked to specific environments and (optionally) projects. Changing the project of this feature may result in this feature returning in a different payload." />
                </Callout>
              )}
            </>
          )}
        </Box>
        <Box mb="4">
          <label>Tags</label>
          <TagsInput
            value={form.watch("tags")}
            onChange={(tags) =>
              form.setValue("tags", tags, { shouldDirty: true })
            }
          />
        </Box>
        <Box mb="4">
          <label>Description</label>
          <Box>
            <MarkdownInput
              value={form.watch("description")}
              setValue={(v) =>
                form.setValue("description", v, { shouldDirty: true })
              }
              placeholder="Short human-readable description"
              showButtons={false}
              hidePreview={false}
            />
          </Box>
        </Box>
      </Box>
    </Modal>
  );
};

export default EditFeatureInfoModal;
