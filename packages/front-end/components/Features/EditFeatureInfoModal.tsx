import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { holdsFeatureMoveDestination } from "shared/permissions";
import { Box } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import TagsInput from "@/components/Tags/TagsInput";
import SelectOwner from "@/components/Owner/SelectOwner";
import useProjectOptions from "@/hooks/useProjectOptions";
import SelectField from "@/components/Forms/SelectField";
import TargetingProjectsField from "@/components/TargetingProjectsField";
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getMetadataEditEnvs, useEnvironments } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useAuth } from "@/services/auth";
import { ConflictProvider } from "@/components/DraftConflicts/ConflictContext";
import { useDraftConflict } from "@/components/DraftConflicts/useDraftConflict";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraftMode } from "@/hooks/useDefaultDraft";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

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
  const allEnvironments = useEnvironments();
  const [showProjectWarningMsg, setShowProjectWarningMsg] = useState(false);
  const { requireProjectForFeatures } = settings;

  const isAdmin = permissionsUtil.canBypassFlagApprovalChecks(
    feature,
    "feature",
  );

  // Gated when requireReviewOn is true and featureRequireMetadataReview is not disabled
  const metadataGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return false;
    return reviewSetting.featureRequireMetadataReview !== false;
  })();

  const form = useForm({
    defaultValues: {
      tags: feature.tags || [],
      owner: feature.owner,
      project: feature.project || "",
      targetingAllProjects: feature.targetingAllProjects || false,
      targetingProjects: feature.targetingProjects || [],
      description: feature.description || "",
    },
  });

  // Publishing metadata requires authority over its footprint and destination.
  const moveDestination = form.watch("project");
  const metadataEnvs = getMetadataEditEnvs({
    feature,
    proposed: {
      project: moveDestination,
      targetingAllProjects: form.watch("targetingAllProjects"),
      targetingProjects: form.watch("targetingProjects"),
    },
    environments: allEnvironments,
  });
  const canPublishMetadata =
    permissionsUtil.canPublishFeature(feature, metadataEnvs) &&
    holdsFeatureMoveDestination(
      permissionsUtil,
      feature,
      moveDestination,
      metadataEnvs,
    );
  const canAutoPublish = (isAdmin || !metadataGated) && canPublishMetadata;

  const { mode: initialMode, defaultDraft } = useDefaultDraftMode(
    revisionList,
    canAutoPublish,
  );

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  const conflict = useDraftConflict<Record<string, unknown>>({
    initial: {
      tags: feature.tags || [],
      owner: feature.owner,
      project: feature.project || "",
      targetingAllProjects: feature.targetingAllProjects || false,
      targetingProjects: feature.targetingProjects || [],
      description: feature.description || "",
    },
    labels: {
      tags: "Tags",
      owner: "Owner",
      project: "Project",
      targetingAllProjects: "Targeting Projects",
      targetingProjects: "Targeting Projects",
      description: "Description",
    },
    form,
    isNewDraft: mode === "new",
    entityNoun: "feature",
  });

  const permissionRequired = (project) =>
    permissionsUtil.canEditFeatureDrafts({ project });
  const initialOption =
    permissionRequired("") && !requireProjectForFeatures ? "None" : "";

  return (
    <ConflictProvider {...conflict.providerProps}>
      <ModalStandard
        trackingEventModalType="edit-feature-info"
        trackingEventModalSource={source}
        header="Edit Feature Information"
        open={true}
        close={cancel}
        submit={form.handleSubmit(async (data) => {
          const guard = conflict.guard(
            data as unknown as Record<string, unknown>,
          );
          const res = await conflict.guarded(() =>
            apiCall<{ draftVersion?: number }>(
              `/feature/${feature.id}`,
              {
                method: "PUT",
                body: JSON.stringify({
                  ...data,
                  baseline: guard.baseline,
                  ...(mode === "publish"
                    ? { autoPublish: true }
                    : mode === "existing"
                      ? { targetDraftVersion: selectedDraft }
                      : { forceNewDraft: true }),
                }),
              },
              guard.onError,
            ),
          );
          conflict.clear();
          mutate();
          const resolvedVersion =
            res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
          if (resolvedVersion !== null && setVersion)
            setVersion(resolvedVersion);
        })}
        cta={mode === "publish" ? "Save" : "Save to draft"}
        ctaEnabled={form.formState.isDirty && conflict.resolved}
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
            alert={conflict.alert}
            alertActive={conflict.alertActive}
          />
          {conflict.callouts}
          <Field
            size="legacy"
            label="Feature Key"
            value={feature.id}
            disabled={true}
            helpText="Feature keys are not editable"
          />
          <Field
            size="legacy"
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
              size="legacy"
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
                {dependents === 1
                  ? "a dependent feature"
                  : "dependent features"}
                . Projects cannot be changed until{" "}
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
          <TargetingProjectsField
            mb="4"
            primaryProject={form.watch("project")}
            allProjects={form.watch("targetingAllProjects")}
            setAllProjects={(v) =>
              form.setValue("targetingAllProjects", v, { shouldDirty: true })
            }
            targetingProjects={form.watch("targetingProjects")}
            setTargetingProjects={(v) =>
              form.setValue("targetingProjects", v, { shouldDirty: true })
            }
          />
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
      </ModalStandard>
    </ConflictProvider>
  );
};

export default EditFeatureInfoModal;
