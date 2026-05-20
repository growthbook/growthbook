import { useMemo } from "react";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import { isRampGenerated } from "@/components/Features/RevisionStatusBadge";

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
