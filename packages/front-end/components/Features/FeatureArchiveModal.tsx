import { FeatureInterface } from "shared/types/feature";
import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { filterEnvironmentsByFeature, getReviewSetting } from "shared/util";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useDefaultDraftMode } from "@/hooks/useDefaultDraft";
import Text from "@/ui/Text";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
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
  const [confirmDependents, setConfirmDependents] = useState(false);

  // Only archiving is gated on dependents; unarchiving is always allowed.
  const needsDependentsAck = !isArchived && totalDependents > 0;

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);

  // Gated by requireReviewOn only, not by metadata or environment review flags
  const archiveGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    return !!reviewSetting?.requireReviewOn;
  })();

  const canAutoPublish = isAdmin || !archiveGated;

  const { mode: initialMode, defaultDraft } = useDefaultDraftMode(
    revisionList,
    canAutoPublish,
  );

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  const canSubmit =
    !loading &&
    (isArchived ||
      ((!needsDependentsAck || confirmDependents) &&
        (confirmEnvBypass || !hasActiveEnvs)));

  return (
    <ModalStandard
      trackingEventModalType=""
      header={isArchived ? "Unarchive Feature" : "Archive Feature"}
      size="lg"
      close={close}
      open={true}
      cta={
        mode === "publish"
          ? isArchived
            ? "Unarchive"
            : "Archive"
          : "Save to draft"
      }
      ctaColor={mode === "publish" ? "red" : "violet"}
      submit={async () => {
        // Explicit so the endpoint doesn't have to guess by toggling feature.archived
        const desiredArchived = !isArchived;
        const res = await apiCall<{ draftVersion?: number }>(
          `/feature/${feature.id}/archive`,
          {
            method: "POST",
            body: JSON.stringify({
              archived: desiredArchived,
              // The user acknowledged the live-dependents warning inline, so
              // bypass the server's soft archive-dependents guard on submit.
              ...(needsDependentsAck ? { ignoreWarnings: true } : {}),
              ...(mode === "publish"
                ? { autoPublish: true }
                : mode === "existing"
                  ? { draftVersion: selectedDraft }
                  : { forceNewDraft: true }),
            }),
          },
        );
        mutate();
        const resolvedVersion =
          res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
        if (resolvedVersion !== null && setVersion) setVersion(resolvedVersion);
      }}
      ctaEnabled={canSubmit}
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
        allowNewDraftAtCap
      />
      {loading ? (
        <Text color="text-disabled">
          <LoadingSpinner /> Checking feature dependencies...
        </Text>
      ) : isArchived ? (
        <p>
          Are you sure you want to continue? This will make the current feature
          active again.
        </p>
      ) : (
        <>
          <Text as="p" mb="4">
            {hasActiveEnvs
              ? "Are you sure you want to continue? This will completely remove the feature from all SDKs and webhooks."
              : "Are you sure you want to continue? This will make the current feature inactive. It will not be included in API responses or Webhook payloads."}
          </Text>

          {/* Warnings, most-disruptive first: active environments, then dependents
              (whose collapsible list renders directly below its callout). */}
          {hasActiveEnvs && (
            <Callout status="warning" mb="4">
              This feature is still active in the following environments:{" "}
              <strong>{enabledEnvs.join(", ")}</strong>.
            </Callout>
          )}
          {needsDependentsAck && (
            <>
              <Callout status="warning" mb="4">
                Archiving this Feature Flag will affect {totalDependents}{" "}
                dependent item{totalDependents > 1 ? "s" : ""} that reference it
                as a prerequisite.
              </Callout>
              <FeatureReferencesList
                features={dependents?.features}
                experiments={dependents?.experiments}
              />
            </>
          )}

          {/* Acknowledgments stacked together at the bottom. */}
          {(needsDependentsAck || hasActiveEnvs) && (
            <Flex direction="column" gap="3" mt="4">
              {needsDependentsAck && (
                <Checkbox
                  weight="regular"
                  value={confirmDependents}
                  setValue={setConfirmDependents}
                  label="I understand these dependents will be affected and want to archive anyway."
                />
              )}
              {hasActiveEnvs && (
                <Checkbox
                  weight="regular"
                  value={confirmEnvBypass}
                  setValue={setConfirmEnvBypass}
                  label="I understand this feature will be immediately disabled in all environments after archiving."
                />
              )}
            </Flex>
          )}
        </>
      )}
    </ModalStandard>
  );
}
