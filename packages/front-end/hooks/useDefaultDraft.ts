import { useMemo } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { isUsersOpenDraft } from "shared/util";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import { isRampGenerated } from "@/components/Reviews/RevisionStatusBadge";
import { DraftMode } from "@/components/DraftSelector";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

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
            (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status) &&
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

// Add Rule starts a new draft unless the viewer is on their own open draft. At
// the draft cap (no bypass) it starts on the usual default draft, matching the
// draft bar, so the bar doesn't open on "new" and then flip.
export function useAddRuleDraftDefault(
  feature: FeatureInterface,
  revisionList: MinimalFeatureRevisionInterface[],
): { mode: DraftMode; defaultDraft: number | null } {
  const ctx = useFeatureRevisionsContext();
  const { userId } = useUser();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const fallbackDraft = useDefaultDraft(revisionList);

  const viewed = revisionList.find((r) => r.version === ctx?.currentVersion);
  const viewedOwnDraft =
    viewed && isUsersOpenDraft(viewed, userId ?? null) ? viewed.version : null;
  const defaultDraft = viewedOwnDraft ?? fallbackDraft;

  const maxDrafts = settings?.maxConcurrentDrafts || 0;
  const activeDraftCount = revisionList.filter(
    (r) =>
      !isRampGenerated(r) &&
      (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
  ).length;
  const newDraftBlocked =
    maxDrafts > 0 &&
    activeDraftCount >= maxDrafts &&
    !permissionsUtil.canBypassFlagApprovalChecks(feature, "feature");

  const mode: DraftMode =
    defaultDraft !== null && (viewedOwnDraft !== null || newDraftBlocked)
      ? "existing"
      : "new";
  return { mode, defaultDraft };
}

// Initial draft mode + target for metadata-style edit modals. When the user
// can't auto-publish and an active draft already exists, default to iterating on
// that draft instead of spawning a fresh one on every save — which otherwise
// leaves a pile of content-identical orphan drafts behind.
export function useDefaultDraftMode(
  revisionList: MinimalFeatureRevisionInterface[],
  canAutoPublish: boolean,
  canWriteIntoDraft?: (revision: MinimalFeatureRevisionInterface) => boolean,
): { mode: DraftMode; defaultDraft: number | null } {
  const defaultDraft = useDefaultDraft(revisionList, canWriteIntoDraft);
  const mode: DraftMode = canAutoPublish
    ? "publish"
    : defaultDraft !== null
      ? "existing"
      : "new";
  return { mode, defaultDraft };
}
