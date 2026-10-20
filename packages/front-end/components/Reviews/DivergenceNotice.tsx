import { formatDistanceToNow } from "date-fns";
import { PiGitMergeBold, PiWarningOctagonBold } from "react-icons/pi";
import type { PublishGovernanceResult } from "shared/util";
import Button from "@/ui/Button";
import NoticeBanner from "@/components/Reviews/NoticeBanner";

export interface DivergenceNoticeProps {
  governance: PublishGovernanceResult;
  liveVersion: number;
  baseVersion: number;
  // Invoked when the user opts to rebase the draft onto the current live
  // version. Omit (or pass canRebase=false) to hide the action. Used for the
  // diverged/stale-approval states (no manual conflict resolution required).
  onUpdateFromLive?: () => void | Promise<void>;
  updating?: boolean;
  canRebase?: boolean;
  // Invoked when the user opts to open the conflict-resolution flow. Used for
  // the hard-conflict state where rebasing requires picking strategies.
  // Omit (or pass canRebase=false) to hide the action.
  onResolveConflicts?: () => void;
  // When the approval is stale: when the surviving approval was given and how
  // many revisions have been published since. Both optional — omitted for
  // legacy approvals that predate the tracking.
  approvedAt?: string | Date | null;
  revisionsSinceApproval?: number | null;
}

// Surfaces governance signals in the publish/review flow. Three distinct
// states are rendered:
//   - "conflict"   — live and draft both touched the same items; user must
//                    pick a per-conflict strategy. CTA: "Fix conflicts".
//   - "diverged"   — live moved past base but no conflict; rebase auto-merges.
//                    CTA: "Rebase with live".
//   - "current" + staleApproval — approval was for older live state; same CTA.
// Renders nothing for "current" drafts with a fresh approval.
export default function DivergenceNotice({
  governance,
  liveVersion,
  baseVersion,
  onUpdateFromLive,
  updating = false,
  canRebase = true,
  onResolveConflicts,
  approvedAt = null,
  revisionsSinceApproval = null,
}: DivergenceNoticeProps) {
  const { divergence, staleApproval, rebaseRequired } = governance;

  // Up-to-date drafts with no stale approval have nothing to surface.
  if (divergence === "current" && !staleApproval) return null;

  // ── Conflict variant ── always blocking; resolution is mandatory before
  // publish regardless of the requireRebaseBeforePublish policy.
  if (divergence === "conflict") {
    return (
      <NoticeBanner
        icon={<PiWarningOctagonBold />}
        iconColor="red"
        title="Draft has conflicts with live"
        body={`Fix conflicts to rebase onto v${liveVersion} before publishing.`}
        action={
          canRebase && onResolveConflicts ? (
            <Button
              variant="outline"
              color="red"
              onClick={() => onResolveConflicts()}
            >
              Fix conflicts
            </Button>
          ) : undefined
        }
      />
    );
  }

  // ── Diverged / stale-approval variant ──
  const title = staleApproval
    ? "This approval is out of date"
    : "Draft is out-of-date with live revision";

  // Quantify the staleness when we can: when the surviving approval was
  // given, and how many revisions live has advanced since.
  const approvedAgo = approvedAt
    ? formatDistanceToNow(new Date(approvedAt), { addSuffix: true })
    : null;
  const advancedPhrase =
    (revisionsSinceApproval ?? 0) > 0
      ? `live has advanced ${revisionsSinceApproval} revision${
          revisionsSinceApproval === 1 ? "" : "s"
        } since (now v${liveVersion})`
      : `changes were published to live (v${liveVersion}) since`;

  const staleBody = approvedAgo
    ? `Approved ${approvedAgo} — ${advancedPhrase}.`
    : `Changes were published to the live version (v${liveVersion}) after this draft was approved.`;

  const body = staleApproval
    ? staleBody
    : `Rebase the latest changes from v${liveVersion} into this draft (branched from v${baseVersion}).`;

  return (
    <NoticeBanner
      icon={<PiGitMergeBold />}
      iconColor={rebaseRequired || staleApproval ? "amber" : "gray"}
      title={title}
      body={body}
      action={
        canRebase && onUpdateFromLive ? (
          <Button
            variant="outline"
            color="violet"
            loading={updating}
            onClick={() => onUpdateFromLive()}
          >
            Rebase with live
          </Button>
        ) : undefined
      }
    />
  );
}
