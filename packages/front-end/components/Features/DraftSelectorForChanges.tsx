import { useMemo } from "react";
import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import {
  getDraftAffectedEnvironments,
  liveRevisionFromFeature,
  getReviewSetting,
  buildEffectiveDraft,
  filterEnvironmentsByFeature,
} from "shared/util";
import { revisionLabelText } from "@/components/Features/RevisionLabel";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import AffectedEnvironmentsBadges from "@/components/Features/AffectedEnvironmentsBadges";
import useOrgSettings from "@/hooks/useOrgSettings";
import useApi from "@/hooks/useApi";
import { useEnvironments } from "@/services/features";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import DraftSelector, { DraftMode } from "@/components/DraftSelector";

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
  gatedEnvSet,
  defaultExpanded = false,
  hideExisting = false,
  triggerPrefix = "Changes will be",
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
  gatedEnvSet: Set<string> | "all" | "none";
  defaultExpanded?: boolean;
  hideExisting?: boolean;
  triggerPrefix?: string;
}) {
  const activeDrafts = useMemo(
    () =>
      revisionList.filter((r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  // Use context revisions if available; fetch only when rendered outside FeaturesOverview.
  const ctx = useFeatureRevisionsContext();
  const draftVersionForFetch =
    mode === "existing" && !ctx
      ? (selectedDraft ?? activeDrafts[0]?.version ?? null)
      : null;
  const { data: fetchedRevisionsData } = useApi<{
    status: 200;
    revisions: FeatureRevisionInterface[];
  }>(
    `/feature/${feature.id}/revisions?versions=${feature.version},${draftVersionForFetch ?? 0}`,
    { shouldRun: () => draftVersionForFetch != null },
  );

  // Org-level approval scope for badge coloring; independent of this action's gating.
  const settings = useOrgSettings();
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
    const draftVersion = selectedDraft ?? activeDrafts[0]?.version;
    if (draftVersion == null) return null;

    const revisions = ctx?.revisions ?? fetchedRevisionsData?.revisions;
    if (!revisions) return null;

    const liveRevision = revisions.find((r) => r.version === feature.version);
    const draftRevision = revisions.find((r) => r.version === draftVersion);
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
    selectedDraft,
    activeDrafts,
    ctx,
    fetchedRevisionsData,
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

  const revisionDropdown = (
    <>
      <RevisionDropdown
        feature={feature}
        revisions={revisionList}
        version={selectedDraft ?? activeDrafts[0]?.version ?? null}
        setVersion={setSelectedDraft}
        draftsOnly
      />
      {affectedEnvs != null && (
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
    <DraftSelector
      hasActiveDrafts={!hideExisting && activeDrafts.length > 0}
      mode={mode}
      setMode={setMode}
      canAutoPublish={canAutoPublish}
      approvalRequired={gatedEnvSet !== "none"}
      defaultExpanded={defaultExpanded}
      triggerPrefix={triggerPrefix}
      existingDraftLabel={existingDraftLabel}
      revisionDropdown={revisionDropdown}
    />
  );
}
