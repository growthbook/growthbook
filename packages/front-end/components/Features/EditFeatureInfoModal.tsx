import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { pick } from "lodash";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  governingReviewProjectsForFeature,
  requiresMetadataReview,
} from "shared/util";
import {
  holdsFeatureMoveDestination,
  holdsTargetingDestination,
  reachedTargeting,
  withStagedTargeting,
} from "shared/permissions";
import { Box } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import TagsInput from "@/components/Tags/TagsInput";
import SelectOwner from "@/components/Owner/SelectOwner";
import useProjectOptions from "@/hooks/useProjectOptions";
import SelectField from "@/components/Forms/SelectField";
import TargetingProjectsField from "@/components/TargetingProjectsField";
import { namedProjectsFormatter } from "@/components/DraftConflicts/conflictValues";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  filterCustomFieldsForSectionAndProject,
  reconcileCustomFieldValues,
} from "@/services/customFields";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getMetadataEditEnvs, useEnvironments } from "@/services/features";
import Tooltip from "@/ui/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { ConflictProvider } from "@/components/DraftConflicts/ConflictContext";
import { useDraftConflict } from "@/components/DraftConflicts/useDraftConflict";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraftMode } from "@/hooks/useDefaultDraft";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import { useFeatureRevisions } from "@/hooks/useFeatureRevisions";

export type FeatureInfoSection =
  | "owner"
  | "project"
  | "targetingProjects"
  | "tags"
  | "customFields";

export const SECTION_HEADERS: Record<FeatureInfoSection, string> = {
  owner: "Edit Owner",
  project: "Edit Project",
  targetingProjects: "Edit Targeting Projects",
  tags: "Edit Tags",
  customFields: "Edit Additional Fields",
};

// What each section writes. Custom fields are rewritten whole, so that section
// sends every field in scope, with only the shown one changed.
const SECTION_FIELDS = {
  owner: ["owner"],
  project: ["project"],
  targetingProjects: ["targetingAllProjects", "targetingProjects"],
  tags: ["tags"],
  customFields: ["customFields"],
} as const satisfies Record<FeatureInfoSection, readonly string[]>;

const EditFeatureInfoModal: FC<{
  // The feature as viewed (draft changes merged in) and as published.
  feature: FeatureInterface;
  baseFeature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  section: FeatureInfoSection;
  // Narrows the customFields section to this one field.
  customFieldId?: string | null;
  cancel: () => void;
  mutate: () => void;
  setVersion?: (v: number) => void;
  source?: string;
  dependents: number;
}> = ({
  feature,
  baseFeature,
  revisionList,
  section,
  customFieldId = null,
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
  const { requireProjectForFeatures } = settings;

  const isAdmin = permissionsUtil.canBypassFlagApprovalChecks(
    feature,
    "feature",
  );

  const { getProjectById, targetingOptOutProjectIds: targetingOptOut } =
    useDefinitions();

  const customFields =
    filterCustomFieldsForSectionAndProject(
      useCustomFields(),
      "feature",
      feature.project,
    ) ?? [];
  const shownCustomFields = customFieldId
    ? customFields.filter((f) => f.id === customFieldId)
    : customFields;

  const initial = {
    tags: feature.tags || [],
    owner: feature.owner,
    project: feature.project || "",
    targetingAllProjects: feature.targetingAllProjects || false,
    targetingProjects: feature.targetingProjects || [],
    customFields: reconcileCustomFieldValues(
      customFields,
      feature.customFields,
      false,
    ),
  };
  const form = useForm({ defaultValues: initial });
  const fields = SECTION_FIELDS[section];

  // Judged over every governing project, current and proposed, the way the
  // endpoint judges it: a targeting project with its own rule can demand
  // review that the primary project alone would not.
  const metadataGated = requiresMetadataReview(
    settings,
    governingReviewProjectsForFeature({
      feature,
      revision: {
        metadata: {
          project: form.watch("project"),
          targetingAllProjects: form.watch("targetingAllProjects"),
          targetingProjects: form.watch("targetingProjects"),
        },
      },
      settings,
    }),
  );

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
    ) &&
    holdsTargetingDestination({
      permissions: permissionsUtil,
      existing: baseFeature,
      proposed: {
        project: moveDestination,
        targetingAllProjects: form.watch("targetingAllProjects"),
        targetingProjects: form.watch("targetingProjects"),
      },
      optedOut: targetingOptOut,
    });
  const canAutoPublish = (isAdmin || !metadataGated) && canPublishMetadata;

  const { mode: initialMode, defaultDraft } = useDefaultDraftMode(
    revisionList,
    canAutoPublish,
  );

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );
  const targetVersion = mode === "existing" ? selectedDraft : null;
  const targetBaseVersion =
    revisionList.find((r) => r.version === targetVersion)?.baseVersion ?? null;
  const targetRevisions = useFeatureRevisions(baseFeature.id, [
    targetVersion,
    targetBaseVersion,
  ]);
  const targetDraft = targetRevisions.get(targetVersion);
  // Anything the flag reaches live, in the draft being written into (live
  // when a new draft is created), or reached when that draft began stays
  // selectable, so removing it can be put back without the permission it
  // would take to add it fresh. Same base as the endpoint.
  const reached = reachedTargeting(
    withStagedTargeting(baseFeature, targetDraft?.metadata),
    baseFeature,
    targetRevisions.get(targetDraft?.baseVersion ?? targetBaseVersion)
      ?.metadata,
  );

  const conflict = useDraftConflict<Record<string, unknown>>({
    initial: pick(initial, fields),
    labels: {
      tags: "Tags",
      owner: "Owner",
      project: "Project",
      targetingAllProjects: "Targeting Projects",
      targetingProjects: "Targeting Projects",
      customFields: "Additional Fields",
    },
    formatters: {
      project: (v) =>
        v ? (getProjectById(String(v))?.name ?? String(v)) : "None",
      targetingProjects: namedProjectsFormatter(getProjectById),
    },
    form,
    isNewDraft: mode === "new",
    entityNoun: "feature",
  });

  const permissionRequired = (project) =>
    permissionsUtil.canEditFeatureDrafts({ project });
  const initialOption =
    permissionRequired("") && !requireProjectForFeatures ? "None" : "";
  const projectOptions = useProjectOptions(
    permissionRequired,
    feature?.project ? [feature.project] : [],
  );

  return (
    <ConflictProvider {...conflict.providerProps}>
      <ModalStandard
        trackingEventModalType="edit-feature-info"
        trackingEventModalSource={source}
        header={
          section === "customFields" && customFieldId
            ? `Edit ${shownCustomFields[0]?.name ?? "Field"}`
            : SECTION_HEADERS[section]
        }
        open={true}
        close={cancel}
        submit={validatedSubmit(form, async (data) => {
          const values: Record<string, unknown> = pick(data, fields);
          const guard = conflict.guard(values);
          const res = await conflict.guarded(() =>
            apiCall<{ draftVersion?: number }>(
              `/feature/${feature.id}`,
              {
                method: "PUT",
                body: JSON.stringify({
                  ...values,
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
        size="md"
      >
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
        {section === "owner" ? (
          <SelectOwner
            value={form.watch("owner")}
            onChange={(v) => form.setValue("owner", v, { shouldDirty: true })}
          />
        ) : null}
        {section === "project" ? (
          <Box mb="4">
            <SelectField
              size="legacy"
              label="Project"
              value={form.watch("project")}
              onChange={(v) =>
                form.setValue("project", v, { shouldDirty: true })
              }
              options={projectOptions}
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
            ) : form.watch("project") !== (feature.project || "") ? (
              <Callout status="warning">
                Changing the project may prevent this Feature and any linked
                Experiments from being sent to users.{" "}
                <Tooltip content="SDK endpoints are linked to specific environments and (optionally) projects. Changing the project of this feature may result in this feature returning in a different payload.">
                  <span tabIndex={0} style={{ display: "inline-flex" }}>
                    <PiInfo />
                  </span>
                </Tooltip>
              </Callout>
            ) : null}
          </Box>
        ) : null}
        {section === "targetingProjects" ? (
          <TargetingProjectsField
            mb="4"
            startOpen
            primaryProject={form.watch("project")}
            allProjects={form.watch("targetingAllProjects")}
            setAllProjects={(v) =>
              form.setValue("targetingAllProjects", v, { shouldDirty: true })
            }
            targetingProjects={form.watch("targetingProjects")}
            setTargetingProjects={(v) =>
              form.setValue("targetingProjects", v, { shouldDirty: true })
            }
            baseline={{
              allProjects: reached.targetingAllProjects,
              targetingProjects: reached.targetingProjects,
            }}
          />
        ) : null}
        {section === "tags" ? (
          <Box mb="4">
            <Box mb="2">
              <Text weight="semibold">Tags</Text>
            </Box>
            <TagsInput
              autoFocus
              value={form.watch("tags")}
              onChange={(tags) =>
                form.setValue("tags", tags, { shouldDirty: true })
              }
            />
          </Box>
        ) : null}
        {section === "customFields" && shownCustomFields.length > 0 ? (
          <CustomFieldInput
            fields={shownCustomFields}
            value={form.watch("customFields")}
            onChange={(value) =>
              form.setValue("customFields", value, { shouldDirty: true })
            }
          />
        ) : null}
      </ModalStandard>
    </ConflictProvider>
  );
};

export default EditFeatureInfoModal;
