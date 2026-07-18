import { useMemo } from "react";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import { isRampGenerated } from "@/components/Reviews/RevisionStatusBadge";
import { DraftMode } from "@/components/DraftSelector";

// Returns the draft version to pre-select in a modal.
// Prefers the revision currently viewed on the feature page (if it's an active draft),
// falling back to the most-recently-updated active draft.
export function useDefaultDraft(
  revisionList: MinimalFeatureRevisionInterface[],
): number | null {
  const ctx = useFeatureRevisionsContext();

  const activeDrafts = useMemo(
    () =>
      revisionList
        .filter(
          (r) =>
            !isRampGenerated(r) &&
            (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
        )
        .sort(
          (a, b) =>
            new Date(b.dateUpdated).getTime() -
            new Date(a.dateUpdated).getTime(),
        ),
    [revisionList],
  );

  return useMemo(() => {
    const currentVer = ctx?.currentVersion;
    if (
      currentVer != null &&
      activeDrafts.some((r) => r.version === currentVer)
    ) {
      return currentVer;
    }
    return activeDrafts[0]?.version ?? null;
  }, [activeDrafts, ctx]);
}

// Initial draft mode + target for metadata-style edit modals. When the user
// can't auto-publish and an active draft already exists, default to iterating on
// that draft instead of spawning a fresh one on every save — which otherwise
// leaves a pile of content-identical orphan drafts behind.
export function useDefaultDraftMode(
  revisionList: MinimalFeatureRevisionInterface[],
  canAutoPublish: boolean,
): { mode: DraftMode; defaultDraft: number | null } {
  const defaultDraft = useDefaultDraft(revisionList);
  const mode: DraftMode = canAutoPublish
    ? "publish"
    : defaultDraft !== null
      ? "existing"
      : "new";
  return { mode, defaultDraft };
}
