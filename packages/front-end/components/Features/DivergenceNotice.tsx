import { Box, Flex } from "@radix-ui/themes";
import { formatDistanceToNow } from "date-fns";
import { PiGitMergeBold, PiWarningOctagonBold } from "react-icons/pi";
import type { PublishGovernanceResult } from "shared/util";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";

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
//                    pick a per-conflict strategy. CTA: "Resolve conflicts".
//   - "diverged"   — live moved past base but no conflict; rebase auto-merges.
//                    CTA: "Update from live".
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
  const {
    divergence,
    staleApproval,
    liveChanges,
    rebaseRequired,
    blockReason,
  } = governance;

  // Up-to-date drafts with no stale approval have nothing to surface.
  if (divergence === "current" && !staleApproval) return null;

  // ── Conflict variant ── always blocking; resolution is mandatory before
  // publish regardless of the requireRebaseBeforePublish policy.
  if (divergence === "conflict") {
    return (
      <Callout
        status="error"
        icon={<PiWarningOctagonBold size={16} />}
        contentsAs="div"
        size="sm"
      >
        <Text as="p" weight="semibold" mb="1">
          Conflicts with the live version
        </Text>
        <Text as="p" mb={canRebase && onResolveConflicts ? "2" : "0"}>
          Changes were published to v{liveVersion} that touch the same items as
          this draft. Resolve each conflict to rebase your draft before
          publishing.
        </Text>

        {canRebase && onResolveConflicts && (
          <Box>
            <Button variant="solid" onClick={() => onResolveConflicts()}>
              Resolve conflicts
            </Button>
          </Box>
        )}
      </Callout>
    );
  }

  // ── Diverged / stale-approval variant ──
  // A stale approval is always at least a warning: the standing approval no
  // longer reflects what publish would do, even when policy doesn't block.
  const status = rebaseRequired || staleApproval ? "warning" : "info";

  const heading = staleApproval
    ? "This approval is out of date"
    : "The live version has changed since this draft was created";

  // Quantify the staleness when we can: when the surviving approval was
  // given, and how many revisions live has advanced since.
  const approvedAgo = approvedAt
    ? formatDistanceToNow(new Date(approvedAt), { addSuffix: true })
    : null;
  const advancedPhrase =
    (revisionsSinceApproval ?? 0) > 0
      ? `the live version has advanced ${revisionsSinceApproval} revision${
          revisionsSinceApproval === 1 ? "" : "s"
        } since (now v${liveVersion})`
      : `changes were published to the live version (v${liveVersion}) since`;

  const staleBody = approvedAgo
    ? `This draft was approved ${approvedAgo}, and ${advancedPhrase}. Update from live and re-review so you publish against the current state.`
    : `Changes were published to the live version (v${liveVersion}) after this draft was approved. Update from live and re-review so you publish against the current state.`;

  const body = staleApproval
    ? staleBody
    : `The items below were published to the live version (v${liveVersion}) after this draft branched from v${baseVersion}. Update from live so your changes apply on top of the current state.`;

  return (
    <Callout
      status={status}
      icon={<PiGitMergeBold size={16} />}
      contentsAs="div"
      size="sm"
    >
      <Text as="p" weight="semibold" mb="1">
        {heading}
      </Text>
      <Text as="p" mb={liveChanges.length > 0 ? "2" : "0"}>
        {body}
      </Text>

      {liveChanges.length > 0 && (
        <Flex wrap="wrap" gap="2" mb="2">
          {liveChanges.map((c) => (
            <Badge key={c.key} color="amber" variant="soft" label={c.name} />
          ))}
        </Flex>
      )}

      {rebaseRequired && blockReason && (
        <Text as="p" weight="medium" mb="2">
          {blockReason}
        </Text>
      )}

      {canRebase && onUpdateFromLive && (
        <Box>
          <Button
            variant="solid"
            loading={updating}
            onClick={() => onUpdateFromLive()}
          >
            Update from live
          </Button>
        </Box>
      )}
    </Callout>
  );
}
