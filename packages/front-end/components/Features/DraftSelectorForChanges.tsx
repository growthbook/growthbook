import { useMemo } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import {
  getDraftAffectedEnvironments,
  liveRevisionFromFeature,
  getReviewSetting,
  buildEffectiveDraft,
  filterEnvironmentsByFeature,
} from "shared/util";
import { revisionLabelText } from "@/components/Reviews/RevisionLabel";
import { isRampGenerated } from "@/components/Reviews/RevisionStatusBadge";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import AffectedEnvironmentsBadges from "@/components/Features/AffectedEnvironmentsBadges";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useEnvironments } from "@/services/features";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import { useFeatureRevisions } from "@/hooks/useFeatureRevisions";
import { DraftMode } from "@/components/DraftSelector";
import SharedDraftSelectorForChanges from "@/components/DraftSelectorForChanges";

export type { DraftMode };

export default function DraftSelectorForChanges({
  feature,
  baseFeature,
  revisionList,
  mode,
  setMode,
  selectedDraft,
  setSelectedDraft,
  canAutoPublish,
  canDraft = true,
  gatedEnvSet,
  defaultExpanded = false,
  hideExisting = false,
  triggerPrefix = "Changes will be",
  allowNewDraftAtCap = false,
  canWriteIntoDraft,
  alert,
  alertActive,
}: {
  feature: FeatureInterface;
  // Un-merged live feature doc; fallback for env state on old sparse live revisions.
  baseFeature?: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraft: number | null;
  setSelectedDraft: (v: number | null) => void;
  canAutoPublish: boolean;
  // Whether the user may author drafts; without it publishing is the only route.
  canDraft?: boolean;
  gatedEnvSet: Set<string> | "all" | "none";
  defaultExpanded?: boolean;
  hideExisting?: boolean;
  triggerPrefix?: string;
  // Keep "create a new draft" available even when the org's soft draft cap is
  // reached — for critical flows (revert, archive) that shouldn't be blocked.
  allowNewDraftAtCap?: boolean;
  /** Only drafts this flow may WRITE into; omit when every active draft is fine. */
  canWriteIntoDraft?: (revision: MinimalFeatureRevisionInterface) => boolean;
  alert?: React.ReactNode;
  alertActive?: boolean;
}) {
  const permissionsUtil = usePermissionsUtil();
  const isAdmin = permissionsUtil.canBypassFlagApprovalChecks(
    feature,
    "feature",
  );

  const activeDrafts = useMemo(
    () =>
      revisionList.filter(
        (r) =>
          !isRampGenerated(r) &&
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  // Soft per-feature draft cap (org setting). The shared shell steers users to
  // an existing draft and blocks creating a new one at/over the cap.
  const settings = useOrgSettings();
  const maxDrafts = settings?.maxConcurrentDrafts || 0;

  const ctx = useFeatureRevisionsContext();
  const targetDraftVersion =
    mode === "existing"
      ? (selectedDraft ?? activeDrafts[0]?.version ?? null)
      : null;
  const targetRevisions = useFeatureRevisions(
    feature.id,
    targetDraftVersion !== null ? [feature.version, targetDraftVersion] : [],
  );

  // Org-level approval scope for badge coloring; independent of this action's gating.
  const approvalScopedEnvSet = useMemo<Set<string> | "all" | "none">(() => {
    const raw = settings?.requireReviews;
    if (!raw) return "none";
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envs = reviewSetting.environments ?? [];
    return envs.length === 0 ? "all" : new Set(envs);
  }, [settings?.requireReviews, feature]);

  const allEnvironments = useEnvironments();
  const affectedEnvs = useMemo<string[] | "all" | null>(() => {
    if (mode !== "existing") return null;
    if (targetDraftVersion === null) return null;

    const liveRevision = targetRevisions.get(feature.version);
    const draftRevision = targetRevisions.get(targetDraftVersion);
    if (!liveRevision || !draftRevision) return null;

    const allEnvIds = filterEnvironmentsByFeature(allEnvironments, feature).map(
      (e) => e.id,
    );
    const liveDoc = baseFeature ?? ctx?.baseFeature ?? feature;
    const filledLive = liveRevisionFromFeature(liveRevision, liveDoc);
    const effectiveDraft = buildEffectiveDraft(draftRevision, filledLive);

    const result = getDraftAffectedEnvironments(
      effectiveDraft,
      filledLive,
      allEnvIds,
    );
    if (Array.isArray(result) && result.length === 0) return null;
    return result;
  }, [
    mode,
    targetDraftVersion,
    targetRevisions,
    ctx?.baseFeature,
    feature,
    baseFeature,
    allEnvironments,
  ]);

  const selectedRevision =
    mode === "existing"
      ? revisionList.find(
          (r) => r.version === (selectedDraft ?? activeDrafts[0]?.version),
        )
      : null;

  const existingDraftLabel = selectedRevision
    ? revisionLabelText(
        selectedRevision.version,
        selectedRevision.title,
        !!selectedRevision.title,
      )
    : null;

  // The dropdown inside THIS control picks a write target — the draft the archive
  // flip is written into — so it lists only drafts this caller may write into. The
  // page-level revision picker uses the same component to VIEW, and there listing
  // every draft is correct; only the write-target instance narrows. Matches the
  // generic twin. The current selection is kept regardless, so a selection made
  // before a permission change still renders its label instead of vanishing.
  const selectableRevisions = canWriteIntoDraft
    ? revisionList.filter(
        (r) =>
          r.version === selectedDraft ||
          !(ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status) ||
          canWriteIntoDraft(r),
      )
    : revisionList;

  const revisionDropdown = (
    <>
      <RevisionDropdown
        feature={feature}
        revisions={selectableRevisions}
        version={selectedDraft ?? activeDrafts[0]?.version ?? null}
        setVersion={setSelectedDraft}
        draftsOnly
      />
      {!!affectedEnvs && (
        <AffectedEnvironmentsBadges
          label="Affected in this draft:"
          affectedEnvs={affectedEnvs}
          allEnvironments={filterEnvironmentsByFeature(
            allEnvironments,
            feature,
          )}
          gatedEnvSet={approvalScopedEnvSet}
        />
      )}
    </>
  );

  return (
    <SharedDraftSelectorForChanges<number>
      activeDraftKeys={activeDrafts.map((r) => r.version)}
      // Only drafts this flow may write into, when narrower than "active". The
      // feature archive endpoint refuses a write into another author's draft, so
      // listing them turned a picker choice into a 403.
      writableDraftKeys={
        canWriteIntoDraft
          ? activeDrafts
              .filter((r) => canWriteIntoDraft(r))
              .map((r) => r.version)
          : undefined
      }
      selectedDraft={selectedDraft}
      setSelectedDraft={setSelectedDraft}
      mode={mode}
      setMode={setMode}
      canAutoPublish={canAutoPublish}
      canDraft={canDraft}
      approvalRequired={gatedEnvSet !== "none"}
      existingDraftLabel={existingDraftLabel}
      revisionDropdown={revisionDropdown}
      defaultExpanded={defaultExpanded}
      hideExisting={hideExisting}
      triggerPrefix={triggerPrefix}
      alert={alert}
      alertActive={alertActive}
      maxDrafts={maxDrafts}
      isAdmin={isAdmin}
      allowNewDraftAtCap={allowNewDraftAtCap}
      capNoun="This feature"
    />
  );
}
