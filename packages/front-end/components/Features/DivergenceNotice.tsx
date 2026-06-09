import { Box, Flex } from "@radix-ui/themes";
import { PiGitMergeBold } from "react-icons/pi";
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
  // version. Omit (or pass canRebase=false) to hide the action.
  onUpdateFromLive?: () => void | Promise<void>;
  updating?: boolean;
  canRebase?: boolean;
}

// Surfaces governance signals in the publish/review flow: when the live version
// has advanced since a draft branched (or an approval has gone stale), this
// explains what changed and encourages — or, under org policy, requires —
// updating from live before publishing. Hard merge conflicts are handled by the
// dedicated conflict resolver, so this renders nothing for the "conflict" case.
export default function DivergenceNotice({
  governance,
  liveVersion,
  baseVersion,
  onUpdateFromLive,
  updating = false,
  canRebase = true,
}: DivergenceNoticeProps) {
  const {
    divergence,
    staleApproval,
    liveChanges,
    rebaseRequired,
    blockReason,
  } = governance;

  // Nothing to surface for up-to-date drafts, and conflicts are owned by the
  // dedicated conflict-resolution flow.
  if (divergence === "conflict") return null;
  if (divergence === "current" && !staleApproval) return null;

  const status = rebaseRequired ? "warning" : "info";

  const heading = staleApproval
    ? "This approval is out of date"
    : "The live version has changed since this draft was created";

  const body = staleApproval
    ? `Changes were published to the live version (v${liveVersion}) after this draft was approved. Update from live and re-review so you publish against the current state.`
    : `The items below were published to the live version (v${liveVersion}) after this draft branched from v${baseVersion}. Update from live so your changes apply on top of the current state.`;

  return (
    <Callout
      status={status}
      icon={<PiGitMergeBold size={16} />}
      contentsAs="div"
      mb="3"
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
