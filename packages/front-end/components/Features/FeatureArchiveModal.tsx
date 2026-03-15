import { FeatureInterface } from "shared/types/feature";
import { useState } from "react";
import { filterEnvironmentsByFeature, getReviewSetting } from "shared/util";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
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
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
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

  const defaultDraft = useDefaultDraft(revisionList);

  const [mode, setMode] = useState<DraftMode>(
    defaultDraft != null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  const canSubmit =
    !loading && totalDependents === 0 && (confirmEnvBypass || !hasActiveEnvs);

  return (
    <Modal
      trackingEventModalType=""
      header={isArchived ? "Unarchive Feature" : "Archive Feature"}
      close={close}
      open={true}
      cta={
        mode === "publish"
          ? isArchived
            ? "Unarchive"
            : "Archive"
          : "Save to draft"
      }
      submitColor={mode === "publish" ? "danger" : "primary"}
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
              ...(mode === "publish"
                ? { autoPublish: true }
                : mode === "existing"
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
      <DraftSelectorForChanges
        feature={feature}
        revisionList={revisionList}
        mode={mode}
        setMode={setMode}
        selectedDraft={selectedDraft}
        setSelectedDraft={setSelectedDraft}
        canAutoPublish={canAutoPublish}
        gatedEnvSet={archiveGated ? "all" : "none"}
      />
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
    </Modal>
  );
}
