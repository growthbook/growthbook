import {
  canStageArchiveDraft,
  canWriteArchiveIntoDraft,
} from "shared/permissions";
import { FeatureInterface } from "shared/types/feature";
import { useCallback, useState } from "react";
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
import { useUser } from "@/services/UserContext";
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
  const { userId } = useUser();

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

  const isAdmin = permissionsUtil.canBypassFlagApprovalChecks(
    feature,
    "feature",
  );

  // Environments the flip actually reaches: the ones the flag serves in. For an
  // unarchive that's where it will resume serving, which is the same set —
  // archiving doesn't clear the per-environment toggles.
  const servingEnvs = getEnabledEnvironments(feature, environments);

  // Mirrors `checkIfRevisionNeedsReview` for an `archived` flip: the rule has to
  // be on for this project, and the flip has to reach an environment the rule
  // protects. A flag serving nowhere reaches none, so it needs no approval.
  // Kept in step with the server deliberately — a stricter client here would
  // push the user into a draft the server would have let them publish.
  const archiveGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return servingEnvs.length > 0;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return false;
    if (servingEnvs.length === 0) return false;
    const gatedEnvs = reviewSetting.environments;
    if (gatedEnvs.length === 0) return true;
    return servingEnvs.some((env) => gatedEnvs.includes(env));
  })();

  // Landing the flip is delete-class when archiving and publish-class when
  // unarchiving — the same split `canLandArchivedState` enforces server-side.
  // Approval gating alone is not enough: a draft-only editor may stage an
  // archive but never land one, however inconsequential the flip.
  const canLandArchiveFlip = isArchived
    ? permissionsUtil.canPublishFeature(feature, servingEnvs)
    : permissionsUtil.canDeleteFeature(feature, servingEnvs);

  const canAutoPublish = (isAdmin || !archiveGated) && canLandArchiveFlip;

  // Only drafts this caller may write `archived` into — the same predicate the
  // picker uses, so the DEFAULT can't land on one the endpoint refuses.
  const canWriteArchiveInto = useCallback(
    (r: MinimalFeatureRevisionInterface) =>
      canWriteArchiveIntoDraft({
        permissions: permissionsUtil,
        model: "feature",
        entity: feature,
        revision: {
          authorId:
            r.createdBy && "id" in r.createdBy ? r.createdBy.id : undefined,
        },
        userId,
      }),
    [permissionsUtil, feature, userId],
  );

  const { mode: initialMode, defaultDraft } = useDefaultDraftMode(
    revisionList,
    canAutoPublish,
    canWriteArchiveInto,
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
        // Left to the shell's `true` default, a publish-only caller was offered
        // "Create a new draft" on an unarchive the endpoint then refuses.
        canDraft={canStageArchiveDraft({
          permissions: permissionsUtil,
          model: "feature",
          // Reviewer/draft eligibility follows the PRIMARY project, so pass it
          // narrowed the way the feature-specific helpers do rather than handing
          // over a feature that also carries targeting projects.
          entity: { project: feature.project },
          archived: !isArchived,
        })}
        // Only drafts this caller may write `archived` into — the endpoint refuses
        // a write into another author's draft.
        canWriteIntoDraft={canWriteArchiveInto}
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
            <Flex direction="column" gap="3" mt="6">
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
                  label={
                    // Only a publish-now archive takes effect immediately. Staging it
                    // as a draft changes nothing until that draft publishes, and the
                    // unconditional wording implied otherwise.
                    mode === "publish"
                      ? "I understand this Feature Flag will be immediately disabled in all environments."
                      : "I understand this Feature Flag will be disabled in all environments when this draft is published."
                  }
                />
              )}
            </Flex>
          )}
        </>
      )}
    </ModalStandard>
  );
}
