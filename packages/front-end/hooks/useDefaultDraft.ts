import { useMemo } from "react";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";

/**
 * Returns the version number of the draft to pre-select in a modal.
 *
 * Prefers the revision currently being viewed on the feature page (from
 * FeatureRevisionsContext) when it is an active draft, so that modals which
 * default to "publish now" still land on the right draft if the user switches
 * to "Add to existing draft". Falls back to the most-recently-created draft.
 */
export function useDefaultDraft(
  revisionList: MinimalFeatureRevisionInterface[],
): number | null {
  const ctx = useFeatureRevisionsContext();

  const activeDrafts = useMemo(
    () =>
      revisionList
        .filter((r) =>
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
        )
        .sort((a, b) => b.version - a.version),
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
