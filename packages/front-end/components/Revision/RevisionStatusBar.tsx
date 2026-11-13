import { ReactNode, useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  PiArrowRight,
  PiCaretDown,
  PiClockFill,
  PiLockSimple,
  PiPencil,
  PiProhibit,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import {
  Revision,
  applyTopLevelPatchOps,
  getRevisionNumberById,
  isScheduledPublishLockActive,
  isScheduledPublishPending,
} from "shared/enterprise";
import { isActiveDraftStatus } from "shared/validators";
import DiscardDraftModal from "@/components/Reviews/DiscardDraftModal";
import RevisionStatusBarView from "@/components/Reviews/RevisionStatusBarView";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import {
  RevisionDiffConfig,
  useRevisionDiff,
} from "@/components/Revision/useRevisionDiff";

/**
 * The generic revision model's bar under the page's tabs, as the feature page
 * shows one: what the viewed revision is, what SDKs serve meanwhile, and what
 * to do next. Renders nothing while viewing live with no drafts.
 */
export default function RevisionStatusBar<T>({
  selectedRevision,
  liveRevision,
  allRevisions,
  liveSnapshot,
  diffConfig,
  entityNoun,
  requiresApproval,
  canDiscard,
  onSelectRevision,
  onReviewPublish,
  onDiscard,
}: {
  // The viewed revision; null while viewing live.
  selectedRevision: Revision | null;
  liveRevision: Revision | null;
  allRevisions: Revision[];
  liveSnapshot: T;
  diffConfig: RevisionDiffConfig<T>;
  entityNoun: string;
  requiresApproval: boolean;
  canDiscard: boolean;
  onSelectRevision: (revision: Revision | null) => void;
  onReviewPublish: () => void;
  onDiscard: (revisionId: string) => Promise<void>;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const numbers = getRevisionNumberById(allRevisions);
  const numberOf = (r: Revision) => numbers.get(r.id) ?? 1;

  const isDraft =
    !!selectedRevision && isActiveDraftStatus(selectedRevision.status);
  // What publishing would change: the draft's edits over live.
  const { diffs } = useRevisionDiff<T>(
    liveSnapshot,
    isDraft
      ? (applyTopLevelPatchOps(
          liveSnapshot as Record<string, unknown>,
          selectedRevision.target.proposedChanges,
        ) as T)
      : liveSnapshot,
    diffConfig,
  );
  const changeCount = diffs.length;

  const drafts = allRevisions.filter((r) => isActiveDraftStatus(r.status));
  const switchToLive = (
    <Link onClick={() => onSelectRevision(null)}>Switch to live</Link>
  );
  // The live revision, named in the message and opened from it.
  const liveRevisionLink = liveRevision ? (
    <Link
      underline="always"
      color="inherit"
      onClick={() => onSelectRevision(null)}
    >
      Revision {numberOf(liveRevision)}
    </Link>
  ) : (
    "the live version"
  );

  let icon: ReactNode;
  let label: string | null = null;
  let message: ReactNode;
  let actions: ReactNode = null;
  if (selectedRevision && isDraft) {
    actions = (
      <>
        {canDiscard ? (
          <Link onClick={() => setConfirmDiscard(true)}>Discard</Link>
        ) : null}
        <Button
          icon={<PiArrowRight />}
          iconPosition="right"
          onClick={onReviewPublish}
        >
          Review &amp; publish
        </Button>
      </>
    );
    if (
      isScheduledPublishPending(selectedRevision) &&
      selectedRevision.scheduledPublishAt
    ) {
      const lockActive = isScheduledPublishLockActive(selectedRevision);
      const editsLocked =
        lockActive && !!selectedRevision.scheduledPublishLockEdits;
      const lockClauses = [
        editsLocked ? "edits are locked" : null,
        lockActive && selectedRevision.scheduledPublishLockOthers
          ? "publishing other drafts is locked"
          : null,
      ].filter((c): c is string => c !== null);
      const inReview =
        selectedRevision.status === "pending-review" ||
        selectedRevision.status === "changes-requested";
      icon = lockClauses.length ? <PiLockSimple /> : <PiClockFill />;
      label = editsLocked ? "Draft · locked" : "Draft · scheduled";
      message = (
        <>
          Publishes {datetime(selectedRevision.scheduledPublishAt)}
          {inReview ? " once approved" : ""}
          {lockClauses.length ? `; ${lockClauses.join(" and ")}` : ""}.
        </>
      );
    } else {
      icon = <PiPencil />;
      label = "Draft · not live";
      message = (
        <>
          {changeCount
            ? `${changeCount} unpublished change${changeCount === 1 ? "" : "s"}.`
            : "No changes yet."}{" "}
          SDKs keep serving {liveRevisionLink} until you publish.
        </>
      );
    }
  } else if (selectedRevision?.status === "discarded") {
    icon = <PiProhibit />;
    label = "Discarded";
    message = "This revision was never published.";
    actions = switchToLive;
  } else if (selectedRevision && selectedRevision.id !== liveRevision?.id) {
    icon = <PiLockSimple />;
    label = "Published · not live";
    message = <>SDKs serve {liveRevisionLink}.</>;
    actions = switchToLive;
  } else if (drafts.length) {
    icon = <PiPencil />;
    message =
      drafts.length === 1
        ? `This ${entityNoun} has a draft.`
        : `This ${entityNoun} has ${drafts.length} drafts.`;
    actions =
      drafts.length === 1 ? (
        <Link onClick={() => onSelectRevision(drafts[0])}>Switch to draft</Link>
      ) : (
        <DropdownMenu
          variant="soft"
          menuPlacement="end"
          trigger={
            <Link>
              <Flex align="center" gap="1">
                Switch to draft
                <PiCaretDown />
              </Flex>
            </Link>
          }
        >
          {drafts.map((d) => (
            <DropdownMenuItem key={d.id} onClick={() => onSelectRevision(d)}>
              <Flex align="center" justify="between" gap="4" width="100%">
                <Text truncate>
                  Revision {numberOf(d)}
                  {d.title ? ` · ${d.title}` : ""}
                </Text>
                {getStatusBadge(d.status, requiresApproval)}
              </Flex>
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      );
  } else {
    return null;
  }

  return (
    <>
      <RevisionStatusBarView
        draft={isDraft}
        icon={icon}
        label={label}
        badge={
          selectedRevision && isDraft && selectedRevision.status !== "draft"
            ? getStatusBadge(selectedRevision.status, requiresApproval)
            : null
        }
        message={message}
        actions={actions}
      />
      {confirmDiscard && selectedRevision ? (
        <DiscardDraftModal
          trackingEventModalType="discard-revision"
          close={() => setConfirmDiscard(false)}
          discard={async () => {
            await onDiscard(selectedRevision.id);
          }}
        />
      ) : null}
    </>
  );
}

// Whether the generic bar has anything to say, so the page can size what
// sticks beneath it.
export function hasRevisionStatus(
  selectedRevision: Revision | null,
  liveRevision: Revision | null,
  allRevisions: Revision[],
): boolean {
  if (selectedRevision && selectedRevision.id !== liveRevision?.id) return true;
  return allRevisions.some((r) => isActiveDraftStatus(r.status));
}
