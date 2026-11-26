import { ReactNode, useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  PiArrowRight,
  PiCaretDown,
  PiClockFill,
  PiLockSimple,
  PiPencil,
  PiProhibit,
  PiWarningFill,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import {
  Revision,
  checkMergeConflicts,
  getRevisionNumberById,
  getRevisionUpdatableFields,
  isScheduledPublishLockActive,
  isScheduledPublishPending,
} from "shared/enterprise";
import { isActiveDraftStatus } from "shared/validators";
import DiscardDraftModal from "@/components/Reviews/DiscardDraftModal";
import RevisionStatusBarView from "@/components/Reviews/RevisionStatusBarView";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  draftLandedState,
  getStatusBadge,
} from "@/components/Revision/revisionUtils";
import {
  RevisionDiffConfig,
  useRevisionBehindLive,
  useRevisionDiff,
} from "@/components/Revision/useRevisionDiff";
import useOrgSettings from "@/hooks/useOrgSettings";

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
  onPublish,
  onDiscard,
  blockedReason = null,
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
  // Publishes a draft from the bar when it needs no approval; null while the
  // viewer can't publish it.
  onPublish: ((revisionId: string) => Promise<void>) | null;
  onDiscard: (revisionId: string) => Promise<void>;
  // Why publishing and discarding have to wait, as the rest of the page says.
  blockedReason?: string | null;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // A publish error is about the content it tried; a change clears it.
  useEffect(
    () => setPublishError(null),
    [selectedRevision?.id, selectedRevision?.dateUpdated],
  );
  const numbers = getRevisionNumberById(allRevisions);
  const numberOf = (r: Revision) => numbers.get(r.id) ?? 1;

  const isDraft =
    !!selectedRevision && isActiveDraftStatus(selectedRevision.status);
  // What publishing would change: the draft's edits over live.
  const { diffs } = useRevisionDiff<T>(
    liveSnapshot,
    isDraft
      ? (draftLandedState(
          selectedRevision,
          liveSnapshot as Record<string, unknown>,
        ) as T)
      : liveSnapshot,
    diffConfig,
  );
  const changeCount = diffs.length;
  const behindLive = useRevisionBehindLive(
    isDraft ? selectedRevision : null,
    liveSnapshot,
    diffConfig,
  );
  const { requireRebaseBeforePublish } = useOrgSettings();
  const mustRebase = behindLive && !!requireRebaseBeforePublish;
  // Straight from the bar only when publishing needs no review: no approval,
  // something to publish, no rebase to do first, no conflicts. The server
  // still checks the rest, and the bar says why it refused.
  const publishable =
    isDraft &&
    !requiresApproval &&
    changeCount > 0 &&
    !mustRebase &&
    !isScheduledPublishPending(selectedRevision) &&
    checkMergeConflicts(
      selectedRevision.target.snapshot as Record<string, unknown>,
      liveSnapshot as Record<string, unknown>,
      selectedRevision.target.proposedChanges,
      getRevisionUpdatableFields(selectedRevision.target.type),
    ).success;

  const drafts = allRevisions.filter((r) => isActiveDraftStatus(r.status));
  const gaveUp = isDraft && !!selectedRevision.scheduledPublishGaveUpAt;
  const barError =
    publishError ??
    (gaveUp ? selectedRevision.scheduledPublishLastError : null);
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
  if (isDraft) {
    actions = (
      <>
        {canDiscard ? (
          <Tooltip content={blockedReason} enabled={!!blockedReason}>
            <Link
              disabled={!!blockedReason}
              onClick={() => setConfirmDiscard(true)}
            >
              Discard
            </Link>
          </Tooltip>
        ) : null}
        {/* Once publishing fails, the review tab is where to see why. */}
        {publishable && onPublish && !publishError && !gaveUp ? (
          <Tooltip content={blockedReason} enabled={!!blockedReason}>
            <Button
              disabled={!!blockedReason}
              onClick={() => onPublish(selectedRevision.id)}
              setError={setPublishError}
            >
              Publish
            </Button>
          </Tooltip>
        ) : (
          <Button
            icon={<PiArrowRight />}
            iconPosition="right"
            onClick={onReviewPublish}
          >
            Review &amp; publish
          </Button>
        )}
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
    } else if (gaveUp) {
      icon = <PiWarningFill />;
      label = "Draft · publish failed";
      message = (
        <>
          Its scheduled publish failed and won&apos;t be retried. SDKs keep
          serving {liveRevisionLink} until you publish.
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
    const failed = drafts.some((d) => d.scheduledPublishGaveUpAt);
    icon = failed ? <PiWarningFill /> : <PiPencil />;
    message =
      (drafts.length === 1
        ? `This ${entityNoun} has a draft.`
        : `This ${entityNoun} has ${drafts.length} drafts.`) +
      (failed ? " A scheduled publish failed." : "");
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
                <Flex align="center" gap="2">
                  {d.scheduledPublishGaveUpAt ? (
                    <Badge
                      label="Publish failed"
                      color="red"
                      variant="soft"
                      radius="full"
                    />
                  ) : null}
                  {getStatusBadge(d.status, requiresApproval)}
                </Flex>
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
          isDraft && selectedRevision.status !== "draft"
            ? getStatusBadge(selectedRevision.status, requiresApproval)
            : null
        }
        message={message}
        error={
          barError ? (
            <HelperText status="error" size="sm">
              {barError}
            </HelperText>
          ) : null
        }
        actions={actions}
      />
      {confirmDiscard && selectedRevision ? (
        <DiscardDraftModal
          trackingEventModalType="discard-revision"
          close={() => setConfirmDiscard(false)}
          discard={() => onDiscard(selectedRevision.id)}
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
