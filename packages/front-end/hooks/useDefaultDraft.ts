import { useMemo } from "react";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { isActiveDraftStatus } from "shared/validators";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import { isRampGenerated } from "@/components/Reviews/RevisionStatusBadge";
import { DraftMode } from "@/components/DraftSelector";

// Returns the draft version to pre-select in a modal.
// Prefers the revision currently viewed on the feature page (if it's an active draft),
// falling back to the most-recently-updated active draft.
export function useDefaultDraft(
  revisionList: MinimalFeatureRevisionInterface[],
  // Drafts this flow may WRITE into. Without it the pre-selection could land on
  // another author's draft — so an archive modal opened already in "existing" mode
  // with a colleague's draft selected, and 403'd on submit with no user action at
  // all. The radio and the cap were filtered; the DEFAULT was not.
  canWriteIntoDraft?: (revision: MinimalFeatureRevisionInterface) => boolean,
): number | null {
  const ctx = useFeatureRevisionsContext();

  const activeDrafts = useMemo(
    () =>
      revisionList
        .filter(
          (r) =>
            !isRampGenerated(r) &&
            isActiveDraftStatus(r.status) &&
            (canWriteIntoDraft?.(r) ?? true),
        )
        .sort(
          (a, b) =>
            new Date(b.dateUpdated).getTime() -
            new Date(a.dateUpdated).getTime(),
        ),
    [revisionList, canWriteIntoDraft],
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

// Initial draft mode + target for metadata-style edit modals. A draft being
// viewed takes the edit, even from someone who could publish it directly.
// Otherwise, when the user can't auto-publish and an active draft already
// exists, default to iterating on that draft instead of spawning a fresh one on
// every save — which otherwise leaves a pile of content-identical orphan drafts
// behind.
export function useDefaultDraftMode(
  revisionList: MinimalFeatureRevisionInterface[],
  canAutoPublish: boolean,
  canWriteIntoDraft?: (revision: MinimalFeatureRevisionInterface) => boolean,
): { mode: DraftMode; defaultDraft: number | null } {
  const ctx = useFeatureRevisionsContext();
  const defaultDraft = useDefaultDraft(revisionList, canWriteIntoDraft);
  const viewingDraft =
    defaultDraft !== null && defaultDraft === ctx?.currentVersion;
  const mode: DraftMode =
    canAutoPublish && !viewingDraft
      ? "publish"
      : defaultDraft !== null
        ? "existing"
        : "new";
  return { mode, defaultDraft };
}
