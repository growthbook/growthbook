import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
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
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import RevisionDropdown from "@/components/Features/RevisionDropdown";

const EditFeatureInfoModal: FC<{
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  cancel: () => void;
  mutate: () => void;
  setVersion?: (v: number) => void;
  source?: string;
  dependents: number;
}> = ({ feature, revisionList, cancel, mutate, setVersion, source, dependents }) => {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const [showProjectWarningMsg, setShowProjectWarningMsg] = useState(false);
  const { requireProjectForFeatures } = settings;

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);

  // Metadata changes are gated when requireReviewOn is true AND
  // featureRequireMetadataReview is not explicitly disabled.
  const metadataGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return false;
    return reviewSetting.featureRequireMetadataReview !== false;
  })();

  const canAutoPublish = isAdmin || !metadataGated;

  const activeDrafts = useMemo(
    () =>
      revisionList.filter((r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  const [autoPublish, setAutoPublish] = useState(canAutoPublish);

  const defaultDraft = useMemo((): number | null => {
    if (activeDrafts.length > 0) return activeDrafts[0].version;
    return null;
  }, [activeDrafts]);

  const [selectedDraft, setSelectedDraft] = useState<number | null>(defaultDraft);
  const displayedDraft = autoPublish ? null : selectedDraft;

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
              ...(autoPublish
                ? { autoPublish: true }
                : selectedDraft != null
                  ? { targetDraftVersion: selectedDraft }
                  : { forceNewDraft: true }),
            }),
          },
        );
        mutate();
        if (res?.draftVersion && setVersion) {
          setVersion(res.draftVersion);
        }
      })}
      cta={autoPublish ? "Save" : "Save to draft"}
      useRadixButton={true}
      size="lg"
    >
      <Box>
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

        <Box mb="3">
          <RevisionDropdown
            feature={feature}
            revisions={revisionList}
            version={displayedDraft}
            setVersion={() => undefined}
            onVersionChange={setSelectedDraft}
            draftsOnly
            variant="select"
            disabled={autoPublish}
          />
          {!autoPublish && (
            <Flex align="center" gap="2" mt="2" wrap="wrap">
              <Text size="small" color="text-low">
                Environments affected in this draft:
              </Text>
              <Badge
                label="all environments"
                color="gray"
                variant="soft"
                radius="small"
                style={{ fontSize: "11px" }}
              />
            </Flex>
          )}
        </Box>

        {canAutoPublish && (
          <Checkbox
            id="edit-info-auto-publish"
            label="Automatically publish as a new revision"
            description={
              metadataGated
                ? "Bypass approval and publish now"
                : "No approval required for metadata changes"
            }
            value={autoPublish}
            setValue={setAutoPublish}
          />
        )}
      </Box>
    </Modal>
  );
};

export default EditFeatureInfoModal;
