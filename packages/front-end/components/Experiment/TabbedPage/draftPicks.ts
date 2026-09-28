import { LinkedFeatureInfo } from "shared/types/experiment";
import { isManagedByExperiment } from "shared/util";

/** Which of a flag's drafts its row shows and saves to. */
export type DraftPick = {
  newestVersion: number | null;
  target: number | "new";
};

/** Draft picks per Feature Flag, shared by the rows and the readouts above them. */
export interface FlagDraftPicks {
  value: Record<string, DraftPick>;
  set: (featureId: string, pick: DraftPick) => void;
}

/**
 * A second draft is only worth starting when the newest also holds changes
 * that can't publish with the experiment; otherwise start would stack both.
 * A managed flag keeps one draft, and a new one needs the rule live.
 */
export function canStartSeparateDraft(
  info: LinkedFeatureInfo,
  experimentId: string,
): boolean {
  return (
    !isManagedByExperiment(info.feature, experimentId) &&
    !!info.liveHasMatchingRule &&
    !!info.pendingDraft?.hasUnrelatedDraftChanges
  );
}

/**
 * The drafts a flag's row chooses among, newest first, and the one it's on. A
 * picked draft holds while it's open; "New draft" holds until a newer draft
 * appears, as saving one does, or starting one stops making sense.
 */
export function resolveDraftPick(
  info: LinkedFeatureInfo,
  pick: DraftPick | undefined,
  experimentId: string,
) {
  const drafts = info.pendingDraft
    ? [info.pendingDraft, ...(info.otherPendingDrafts ?? [])]
    : [];
  const picked = pick?.target;
  const startsNew =
    picked === "new" &&
    pick?.newestVersion === (drafts[0]?.version ?? null) &&
    canStartSeparateDraft(info, experimentId);
  const draft =
    (typeof picked === "number"
      ? drafts.find((d) => d.version === picked)
      : undefined) ?? drafts[0];
  return {
    drafts,
    // Kept when starting a new one, so the menu still offers the drafts.
    draft,
    target: startsNew || !draft ? ("new" as const) : ("draft" as const),
    // Only the newest draft that changes the rule publishes at start.
    launches: !draft || draft.version === drafts[0]?.version,
  };
}

/** The flag with the draft its row picked in place of the newest, or none when starting one. */
export function withPickedDraft(
  info: LinkedFeatureInfo,
  pick: DraftPick | undefined,
  experimentId: string,
): LinkedFeatureInfo {
  const { draft, target } = resolveDraftPick(info, pick, experimentId);
  const pendingDraft = target === "draft" ? draft : undefined;
  return pendingDraft === info.pendingDraft ? info : { ...info, pendingDraft };
}
