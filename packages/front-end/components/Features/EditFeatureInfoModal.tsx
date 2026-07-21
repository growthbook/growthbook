import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { Box } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import TagsInput from "@/components/Tags/TagsInput";
import SelectOwner from "@/components/Owner/SelectOwner";
import useProjectOptions from "@/hooks/useProjectOptions";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import RadioGroup from "@/ui/RadioGroup";
import Link from "@/ui/Link";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useAuth } from "@/services/auth";
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
  const { projects } = useDefinitions();
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

  const { mode: initialMode, defaultDraft } = useDefaultDraftMode(
    revisionList,
    canAutoPublish,
  );

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  const form = useForm({
    defaultValues: {
      tags: feature.tags || [],
      owner: feature.owner,
      project: feature.project || "",
      visibilityAllProjects: feature.visibilityAllProjects || false,
      visibilityProjects: feature.visibilityProjects || [],
      description: feature.description || "",
    },
  });

  // UI-only reveal: collapsed to a "+ Add" link until the user opts in, or
  // seeded open when the feature already has any secondary visibility.
  const [secondaryVisibilityEnabled, setSecondaryVisibilityEnabled] =
    useState<boolean>(
      () =>
        !!feature.visibilityAllProjects ||
        (feature.visibilityProjects?.length ?? 0) > 0,
    );

  const permissionRequired = (project) =>
    permissionsUtil.canUpdateFeature(feature, { project });
  const initialOption =
    permissionRequired("") && !requireProjectForFeatures ? "None" : "";

  return (
    <ModalStandard
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
        if (resolvedVersion !== null && setVersion) setVersion(resolvedVersion);
      })}
      cta={mode === "publish" ? "Save" : "Save to draft"}
      ctaEnabled={form.formState.isDirty}
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
          {!secondaryVisibilityEnabled ? (
            <Link onClick={() => setSecondaryVisibilityEnabled(true)}>
              <PiPlus /> Add visibility projects
            </Link>
          ) : (
            <>
              <label>Visibility projects</label>
              <RadioGroup
                width="100%"
                value={form.watch("visibilityAllProjects") ? "all" : "specific"}
                setValue={(v) =>
                  form.setValue("visibilityAllProjects", v === "all", {
                    shouldDirty: true,
                  })
                }
                gap="0"
                options={[
                  {
                    value: "specific",
                    label: "Specific projects",
                    renderOutsideItem: true,
                    renderOnSelect: (
                      <Box pl="5">
                        <MultiSelectField
                          value={form.watch("visibilityProjects")}
                          onChange={(v) =>
                            form.setValue("visibilityProjects", v, {
                              shouldDirty: true,
                            })
                          }
                          options={projects
                            .filter((p) => p.id !== form.watch("project"))
                            .map((p) => ({ value: p.id, label: p.name }))}
                          placeholder="Select projects..."
                          sort={false}
                          containerClassName="w-full"
                        />
                      </Box>
                    ),
                  },
                  {
                    value: "all",
                    label: "All projects",
                    itemClassName: "mt-2",
                  },
                ]}
              />
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
    </ModalStandard>
  );
};

export default EditFeatureInfoModal;
