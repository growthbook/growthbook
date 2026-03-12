import { FeatureInterface } from "shared/types/feature";
import { useState } from "react";
import { filterEnvironmentsByFeature, getReviewSetting } from "shared/util";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import Checkbox from "@/ui/Checkbox";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import FeatureReferencesList from "./FeatureReferencesList";

interface FeatureArchiveModalProps {
  feature: FeatureInterface;
  close: () => void;
  revisionList: MinimalFeatureRevisionInterface[];
  mutate: () => void;
  setVersion?: (v: number) => void;
}

export default function FeatureArchiveModal({
  feature,
  close,
  revisionList,
  mutate,
  setVersion,
}: FeatureArchiveModalProps) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const { dependents, loading } = useFeatureDependents(feature.id);
  const totalDependents =
    (dependents?.features.length ?? 0) + (dependents?.experiments.length ?? 0);
  const isArchived = feature.archived;

  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const enabledEnvs = isArchived
    ? []
    : getEnabledEnvironments(feature, environments);
  const hasActiveEnvs = enabledEnvs.length > 0;

  const [confirmEnvBypass, setConfirmEnvBypass] = useState(!hasActiveEnvs);

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);

  // Archive approval is gated by the top-level requireReviewOn setting only —
  // not by featureRequireMetadataReview or featureRequireEnvironmentReview.
  const archiveGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    return !!reviewSetting?.requireReviewOn;
  })();

  const canAutoPublish = isAdmin || !archiveGated;

  const [autoPublish, setAutoPublish] = useState(canAutoPublish);

  const [selectedDraft, setSelectedDraft] = useState<number | null>(null);
  const displayedDraft = autoPublish ? null : selectedDraft;

  const canSubmit =
    !loading && totalDependents === 0 && (confirmEnvBypass || !hasActiveEnvs);

  return (
    <Modal
      trackingEventModalType=""
      header={isArchived ? "Unarchive Feature" : "Archive Feature"}
      close={close}
      open={true}
      cta={
        autoPublish ? (isArchived ? "Unarchive" : "Archive") : "Save to draft"
      }
      submitColor={autoPublish ? "danger" : "primary"}
      submit={async () => {
        // Desired new archived state — explicit so the endpoint never has to
        // guess by toggling `feature.archived` (which may differ from the
        // draft's current archived field).
        const desiredArchived = !isArchived;
        const res = await apiCall<{ draftVersion?: number }>(
          `/feature/${feature.id}/archive`,
          {
            method: "POST",
            body: JSON.stringify({
              archived: desiredArchived,
              ...(autoPublish
                ? { autoPublish: true }
                : selectedDraft != null
                  ? { draftVersion: selectedDraft }
                  : { forceNewDraft: true }),
            }),
          },
        );
        mutate();
        if (res?.draftVersion && setVersion) {
          setVersion(res.draftVersion);
        }
        close();
      }}
      ctaEnabled={canSubmit}
      useRadixButton={true}
    >
      {loading ? (
        <Text color="text-disabled">
          <LoadingSpinner /> Checking feature dependencies...
        </Text>
      ) : totalDependents > 0 ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="semibold" mb="2">
              Cannot {isArchived ? "unarchive" : "archive"} feature
            </Text>
            <Text as="p" mb="0">
              Before you can {isArchived ? "unarchive" : "archive"} this
              feature, you will need to remove any references to it. Check the
              following item
              {totalDependents > 1 && "s"} below:
            </Text>
          </Callout>
          <FeatureReferencesList
            features={dependents?.features}
            experiments={dependents?.experiments}
          />
        </>
      ) : hasActiveEnvs ? (
        <>
          <Text as="p" mb="4">
            Are you sure you want to continue? This will completely remove the
            feature from all SDKs and webhooks.
          </Text>
          <Callout status="warning" mb="4">
            This feature is still active in the following environments:{" "}
            <strong>{enabledEnvs.join(", ")}</strong>.
          </Callout>
          <Checkbox
            value={confirmEnvBypass}
            setValue={setConfirmEnvBypass}
            label="I understand that all environments will be immediately disabled after archiving."
          />
        </>
      ) : isArchived ? (
        <p>
          Are you sure you want to continue? This will make the current feature
          active again.
        </p>
      ) : (
        <p>
          Are you sure you want to continue? This will make the current feature
          inactive. It will not be included in API responses or Webhook
          payloads.
        </p>
      )}

      <Box mt="4" mb="3">
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
          id="archive-auto-publish"
          label="Automatically publish as a new revision"
          description={
            archiveGated
              ? "Bypass approval and publish now"
              : "No approval required for archive changes"
          }
          value={autoPublish}
          setValue={setAutoPublish}
        />
      )}
    </Modal>
  );
}
