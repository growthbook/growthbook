import { RevisionLog } from "shared/types/feature-revision";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  PiArrowCounterClockwiseFill,
  PiCaretDown,
  PiCaretRight,
  PiChatCircleTextFill,
  PiCheckBold,
  PiClockFill,
  PiGearFill,
  PiFilePlus,
  PiGitCommit,
  PiPencilSimpleFill,
  PiPlusMinusBold,
  PiProhibitFill,
  PiRocketLaunch,
  PiSpinnerGap,
} from "react-icons/pi";
import { date, datetime } from "shared/dates";
import React, { useMemo, useState } from "react";
import stringify from "json-stringify-pretty-compact";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import EventUser from "@/components/Avatar/EventUser";
import Avatar from "@/ui/Avatar";
import Code from "@/components/SyntaxHighlighting/Code";
import MarkdownWithDiffRefs from "@/components/Reviews/DiffCommentMarkdown";
import CommentCard from "@/components/Comments/CommentCard";
import CommentComposer from "@/components/Comments/CommentComposer";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

// Shared, presentational review/activity timeline. Behavior and visuals are the
// feature implementation, moved here verbatim; only the data/endpoint boundary
// is parameterized so any entity (features, saved groups, …) can drive it:
//   - `logs`              the chronological activity, in the RevisionLog shape
//   - `onEditComment`     persist an edited comment (entity owns the endpoint)
//   - `onDeleteComment`   delete a comment
//   - `onRetractVerdict`  withdraw the current user's active verdict
// The component does no fetching of its own — wrappers supply `logs` and the
// callbacks. Ownership and verdict-retraction logic stay here so every entity
// gets identical behavior.

// Events the review Conversation tab keeps uncollapsed. Everything else (rule
// edits, rebases, metadata changes, …) collapses into "N other events" runs;
// the Changes tab shows the full timeline.
export const REVIEW_ACTIVITY_ACTIONS = new Set([
  // Conversation
  "Comment",
  // Verdicts & review state
  "Approved",
  "Requested Changes",
  "Review Requested",
  "Recall Review",
  "Undo Review",
  // Critical revision lifecycle
  "new revision",
  "publish",
  "re-publish",
  "revert",
  "discard",
  "reopen",
  // Deferred (scheduled) publish lifecycle
  "schedule publish",
  "update scheduled publish",
  "cancel scheduled publish",
]);

// Action sets must mirror EDITABLE_AUTHOR_ACTIONS / DELETABLE_AUTHOR_ACTIONS
// in FeatureRevisionLogModel. Reviewers can rewrite the comment text on
// their own verdicts (the action itself stays immutable); only plain
// `Comment` entries can be deleted outright.
const EDITABLE_AUTHOR_ACTIONS = new Set([
  "Comment",
  "Approved",
  "Requested Changes",
]);
const DELETABLE_AUTHOR_ACTIONS = new Set(["Comment"]);

// Per-action visual config: only entries with readable
// content (a comment) render as full cards; everything else renders as a
// compact one-line timeline event with a semantic icon. The `default` case
// covers system audit events with a neutral gray icon and an expandable
// JSON disclosure for inspection.
type RowVisual = {
  color: string;
  verb: string;
  icon: React.ReactNode;
  // Render the entry's `value.comment` (when present) as a Markdown body in
  // a full card. Entries without a body always fall back to the inline
  // event presentation.
  showCommentBody: boolean;
  // Offer an expandable "Details" disclosure with the raw JSON payload when
  // the entry has structured data. Used for generic audit events; `edit
  // comment` opts out because the text already lives in the description panel
  // above the log.
  showAuditDetails: boolean;
};

// Readable past-tense phrases for system audit actions so inline events read
// as a sentence ("Bryce created a new revision"). Keys must match the raw
// `action` strings written to the revision log on the backend.
const AUDIT_ACTION_VERBS: Record<string, string> = {
  "new revision": "created a new revision",
  update: "updated this revision",
  publish: "published this revision",
  "re-publish": "re-published this revision",
  rebase: "rebased this revision",
  revert: "created this revert",
  "add rule": "added a rule",
  "add rule with ramp schedule": "added a rule with a ramp schedule",
  "add experiment rule": "added an experiment rule",
  "edit rule": "edited a rule",
  "edit rule with ramp schedule": "edited a rule and its ramp schedule",
  "delete rule": "deleted a rule",
  "move rule": "moved a rule",
  "reorder rules": "reordered the rules",
  "edit default value": "edited the default value",
  "edit prerequisites": "edited the prerequisites",
  "edit title": "edited the revision title",
  "edit metadata": "edited the revision metadata",
  "set ramp schedule": "set a ramp schedule",
  "clear ramp schedule": "cleared a ramp schedule",
  "schedule publish": "scheduled this revision to publish",
  "update scheduled publish": "updated the publish schedule",
  "cancel scheduled publish": "canceled the publish schedule",
  "Recall Review": "recalled their review request",
  "Undo Review": "withdrew their review",
};

function auditVerb(action: string): string {
  return (
    AUDIT_ACTION_VERBS[action] ?? `made a change (${action.toLowerCase()})`
  );
}

// Icons and colors mirror RevisionStatusBadge so the timeline and the
// actions-column header speak the same visual language.
function rowVisual(action: string): RowVisual {
  switch (action) {
    case "Comment":
      return {
        color: "violet",
        verb: "commented",
        icon: <PiChatCircleTextFill />,
        showCommentBody: true,
        showAuditDetails: false,
      };
    case "Approved":
      return {
        color: "green",
        // Standalone glyph — the surrounding circle (solid verdict avatar or
        // soft inline badge) acts as the check's container.
        verb: "approved these changes",
        icon: <PiCheckBold />,
        showCommentBody: true,
        showAuditDetails: false,
      };
    case "Requested Changes":
      return {
        color: "red",
        verb: "requested changes",
        icon: <PiPlusMinusBold />,
        showCommentBody: true,
        showAuditDetails: false,
      };
    case "Review Requested":
      return {
        color: "orange",
        verb: "requested a review",
        // Spinner glyph (not a clock) — distinct from the scheduled-publish clock.
        icon: <PiSpinnerGap />,
        showCommentBody: false,
        showAuditDetails: false,
      };
    case "edit comment":
      return {
        color: "gray",
        verb: "edited the revision description",
        icon: <PiPencilSimpleFill />,
        showCommentBody: false,
        showAuditDetails: false,
      };
    case "edit title":
      return {
        color: "gray",
        verb: "edited the revision title",
        icon: <PiPencilSimpleFill />,
        showCommentBody: false,
        showAuditDetails: false,
      };
    case "new revision":
      return {
        color: "indigo",
        verb: auditVerb(action),
        icon: <PiFilePlus />,
        showCommentBody: false,
        // Keep the default-case Details disclosure — the payload carries the
        // base-revision context.
        showAuditDetails: true,
      };
    case "publish":
    case "re-publish":
      return {
        color: "indigo",
        verb:
          action === "publish"
            ? "published this revision"
            : "re-published this revision",
        icon: <PiRocketLaunch />,
        // Publishes are plain lifecycle markers. Legacy entries may still
        // carry a comment in their payload — ignore it and render the
        // standard inline event.
        showCommentBody: false,
        showAuditDetails: false,
      };
    case "discard":
      return {
        color: "gray",
        verb: "discarded this revision",
        icon: <PiProhibitFill />,
        showCommentBody: false,
        showAuditDetails: false,
      };
    case "reopen":
      return {
        color: "indigo",
        verb: "reopened this revision as a draft",
        icon: <PiArrowCounterClockwiseFill />,
        showCommentBody: false,
        showAuditDetails: false,
      };
    case "schedule publish":
    case "update scheduled publish":
      return {
        color: "amber",
        verb: auditVerb(action),
        icon: <PiClockFill />,
        showCommentBody: false,
        // Keep the Details disclosure so the date + lock payload is inspectable.
        showAuditDetails: true,
      };
    case "cancel scheduled publish":
      return {
        color: "gray",
        verb: auditVerb(action),
        icon: <PiProhibitFill />,
        showCommentBody: false,
        showAuditDetails: false,
      };
    default:
      return {
        color: "gray",
        verb: auditVerb(action),
        icon: <PiGearFill />,
        showCommentBody: false,
        showAuditDetails: true,
      };
  }
}

export type VerdictRetraction = {
  // "self": the reviewer pulled it back via Undo Review.
  // "recall": the review request was recalled, invalidating any in-flight
  //   verdicts (regardless of which user submitted them).
  kind: "self" | "recall";
  // Display label rendered in the metadata badge (e.g. "Retracted",
  // "Discarded by Bryce").
  label: string;
};

export function RevisionLogRow({
  log,
  onEditComment,
  onDeleteComment,
  retraction,
  onRetractVerdict,
}: {
  log: RevisionLog;
  first?: boolean;
  // Persist edited comment text for this entry. When omitted (or the entry
  // isn't an editable, owned action) the Edit affordance is hidden.
  onEditComment?: (logId: string, comment: string) => Promise<void>;
  // Delete this entry. When omitted (or not a deletable, owned action) the
  // Delete affordance is hidden.
  onDeleteComment?: (logId: string) => Promise<void>;
  // When set, the verdict (Approved / Requested Changes) is no longer
  // active: card shows a muted "Retracted" / "Discarded by …" badge.
  retraction?: VerdictRetraction | null;
  // When provided on the user's own *active* verdict, surfaces a
  // "Retract review" action in the card's overflow menu (more discoverable
  // than the actions-column dropdown).
  onRetractVerdict?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { userId } = useUser();

  let value = log.value;
  let valueContainsData = false;
  try {
    const valueAsJson = JSON.parse(log.value);
    value = stringify(valueAsJson);
    valueContainsData = Object.keys(valueAsJson).length > 0;
  } catch (e) {
    valueContainsData = value.length > 0;
  }
  let comment: string | undefined;
  try {
    comment = JSON.parse(log.value)?.comment;
  } catch (e) {
    // not JSON
  }

  const visual = rowVisual(log.action);

  // The current user owns the entry and we have the wiring (a logId + the
  // matching callback) to mutate it. Edit and delete have different policies:
  // comments can be edited or deleted, verdicts only have their comment text
  // edited (retract via Undo Review to remove the verdict). Owners can still
  // revise the comment text on a retracted verdict, e.g. to clarify why they
  // pulled back.
  const logUserId =
    log.user && "id" in log.user ? (log.user as { id: string }).id : null;
  const logId = log.id ?? null;
  const isOwned = logId !== null && logUserId !== null && logUserId === userId;
  const canEdit =
    isOwned && !!onEditComment && EDITABLE_AUTHOR_ACTIONS.has(log.action);
  const canDelete =
    isOwned && !!onDeleteComment && DELETABLE_AUTHOR_ACTIONS.has(log.action);
  // Retract is offered on the user's *own* active (non-retracted) verdict
  // when the parent has wired up a handler.
  const canRetractVerdict =
    isOwned &&
    !retraction &&
    !!onRetractVerdict &&
    (log.action === "Approved" || log.action === "Requested Changes");

  if (editing && canEdit && logId) {
    return (
      <CommentComposer
        cta="Save"
        placeholder="Add a comment…"
        initialValue={comment ?? ""}
        autofocus
        onCancel={() => setEditing(false)}
        onSubmit={async (next) => {
          await onEditComment?.(logId, next);
          setEditing(false);
        }}
      />
    );
  }

  const renderAsCard = visual.showCommentBody && !!comment;
  // Replace the user avatar with a colored verdict icon (green check for
  // approvals, red speech bubble for change requests) so the timeline reads
  // at a glance. Plain comments keep the user avatar.
  const verdictAvatarColor: "green" | "red" | null =
    log.action === "Approved"
      ? "green"
      : log.action === "Requested Changes"
        ? "red"
        : null;
  const verdictLeading = verdictAvatarColor ? (
    <Avatar size="md" color={verdictAvatarColor} variant="solid">
      <>{visual.icon}</>
    </Avatar>
  ) : undefined;

  if (renderAsCard) {
    return (
      // Jump target for diff gutter markers (see scrollToRevisionLogEntry).
      <Box data-revision-log-id={log.id ?? undefined}>
        <CommentCard
          user={log.user}
          metadata={`${visual.verb} on ${datetime(log.timestamp)}`}
          stripeColor={visual.color}
          leading={verdictLeading}
          avatarSize="md"
          metadataExtra={
            retraction ? (
              <Badge
                color="gray"
                variant="solid"
                label={retraction.label}
                size="xs"
              />
            ) : undefined
          }
          actions={
            canEdit || canDelete || canRetractVerdict ? (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                  >
                    <BsThreeDotsVertical size={14} />
                  </IconButton>
                }
                variant="soft"
                menuPlacement="end"
              >
                {canEdit && (
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    Edit
                  </DropdownMenuItem>
                )}
                {canRetractVerdict && (
                  <DropdownMenuItem
                    onClick={() => {
                      void onRetractVerdict?.();
                    }}
                  >
                    Retract review
                  </DropdownMenuItem>
                )}
                {canDelete && logId && (
                  <DropdownMenuItem
                    color="red"
                    confirmation={{
                      confirmationTitle: "Delete Comment",
                      cta: "Delete",
                      submit: async () => {
                        await onDeleteComment?.(logId);
                      },
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenu>
            ) : undefined
          }
          body={
            <MarkdownWithDiffRefs className="speech-bubble" highlightCode>
              {comment ?? ""}
            </MarkdownWithDiffRefs>
          }
        />
      </Box>
    );
  }

  // ── Inline timeline event ──
  // [icon badge sized/aligned to match card avatars] [name + verb + time]
  const showDetails = visual.showAuditDetails && valueContainsData;
  return (
    <Box py="2">
      <Flex align="center" gap="3">
        {/* Verdicts use the same solid avatar as their card render so an
            approval reads identically with or without a comment. */}
        {verdictLeading ?? (
          <Flex
            align="center"
            justify="center"
            flexShrink="0"
            style={{
              // Matches the md (size "2" = 32px) card avatars.
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: `var(--${visual.color}-a3)`,
              color: `var(--${visual.color}-11)`,
              fontSize: 20,
            }}
          >
            {visual.icon}
          </Flex>
        )}
        <Text size="small" color="text-high">
          <Text size="inherit" weight="medium">
            <EventUser user={log.user} display="name" size="sm" />
          </Text>{" "}
          {visual.verb}{" "}
          <Text size="inherit" color="text-low">
            on {datetime(log.timestamp)}
          </Text>
        </Text>
        {retraction && (
          <Badge
            color="gray"
            variant="solid"
            label={retraction.label}
            size="xs"
          />
        )}
        {showDetails && (
          <Button
            variant="ghost"
            color="gray"
            size="xs"
            mt="0"
            mb="0"
            icon={open ? <PiCaretDown /> : <PiCaretRight />}
            onClick={() => setOpen((o) => !o)}
          >
            Details
          </Button>
        )}
      </Flex>
      {showDetails && open && (
        <Box mt="2" ml="6">
          <Code language="json" code={value} />
        </Box>
      )}
    </Box>
  );
}

// Splits the full chronological log into alternating runs of visible entries
// and collapsed "N other events" runs (entries failing the collapse
// predicate). Runs ignore date boundaries — consecutive collapsed entries
// merge into a single toggle even when they span several dates — so visible
// entries carry date headers per-date within their run, and collapsed runs
// pre-bucket their entries by date for when they're expanded. Run ids key the
// expand/collapse state and stay stable as new entries append (they derive
// from the run's first entry).
type TimelineEntry = { log: RevisionLog; key: string };
type TimelineDateGroup = { date: string; logs: TimelineEntry[] };
type TimelineBlock =
  | ({ type: "date" } & TimelineDateGroup)
  | { type: "collapsed"; id: string; groups: TimelineDateGroup[] };

function buildTimelineBlocks(
  sorted: RevisionLog[],
  collapseFilter?: (log: RevisionLog) => boolean,
): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  sorted.forEach((log, i) => {
    const key = log.id ?? `log-${i}`;
    const entry: TimelineEntry = { log, key };
    const d = date(log.timestamp);
    const last = blocks[blocks.length - 1];
    if (!collapseFilter || collapseFilter(log)) {
      if (last && last.type === "date" && last.date === d)
        last.logs.push(entry);
      else blocks.push({ type: "date", date: d, logs: [entry] });
    } else if (last && last.type === "collapsed") {
      const lastGroup = last.groups[last.groups.length - 1];
      if (lastGroup.date === d) lastGroup.logs.push(entry);
      else last.groups.push({ date: d, logs: [entry] });
    } else {
      blocks.push({
        type: "collapsed",
        id: `run-${key}`,
        groups: [{ date: d, logs: [entry] }],
      });
    }
  });
  return blocks;
}

export default function RevisionTimeline({
  logs,
  collapseFilter,
  onEditComment,
  onDeleteComment,
  onRetractVerdict,
  emptyText = "No history for this revision.",
}: {
  logs: RevisionLog[];
  // When provided, entries failing the predicate are collapsed into
  // "N other events" toggles (one per consecutive run, within each date
  // group) instead of rendering inline. The verdict-retraction scan still
  // runs over the full log so review-state badges stay correct.
  collapseFilter?: (log: RevisionLog) => boolean;
  onEditComment?: (logId: string, comment: string) => Promise<void>;
  onDeleteComment?: (logId: string) => Promise<void>;
  // Withdraw the current user's active verdict. Wired only to that one row.
  onRetractVerdict?: () => void | Promise<void>;
  emptyText?: string;
}) {
  const { userId } = useUser();
  // Which collapsed "N other events" runs the user has expanded.
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());

  const { blocks, verdictRetractions, activeVerdictForCurrentUser } =
    useMemo(() => {
      // Chronological (newest at the bottom) — the comment composer sits
      // below the timeline, where new entries append.
      const sorted = [...logs].sort((a, b) =>
        (a.timestamp as unknown as string).localeCompare(
          b.timestamp as unknown as string,
        ),
      );
      // A verdict (Approved / Requested Changes) is invalidated by the FIRST
      // of the following events to appear after it:
      //   - same-user `Undo Review`           → "Retracted"
      //   - any-user `Recall Review`          → "Discarded by {recaller}"
      //   - same-user new verdict             → superseded (no badge)
      // A subsequent `Review Requested` resets the window — verdicts after
      // that point are fresh decisions on the re-requested review.
      const retractions = new WeakMap<RevisionLog, VerdictRetraction>();
      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        if (entry.action !== "Approved" && entry.action !== "Requested Changes")
          continue;
        const uid =
          entry.user && "id" in entry.user ? entry.user.id : undefined;
        if (!uid) continue;
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          if (next.action === "Review Requested") {
            // New review cycle started; previous verdicts are historical but
            // not marked retracted/discarded by this scan — only events
            // between i and the recall/undo count.
            break;
          }
          if (next.action === "Recall Review") {
            const recallerName =
              (next.user && "name" in next.user && next.user.name) ||
              (next.user && "email" in next.user && next.user.email) ||
              null;
            const isSelfRecall =
              next.user && "id" in next.user && next.user.id === userId;
            const label = isSelfRecall
              ? "Discarded by you"
              : recallerName
                ? `Discarded by ${recallerName}`
                : "Discarded";
            retractions.set(entry, { kind: "recall", label });
            break;
          }
          const nextUid =
            next.user && "id" in next.user ? next.user.id : undefined;
          if (nextUid !== uid) continue;
          if (next.action === "Undo Review") {
            retractions.set(entry, { kind: "self", label: "Retracted" });
            break;
          }
          if (
            next.action === "Approved" ||
            next.action === "Requested Changes"
          ) {
            // Superseded by a fresh verdict; not a retraction.
            break;
          }
        }
      }
      // Find the current user's most recent active verdict (not retracted and
      // not superseded). This is the row that gets the "Retract review" item.
      let activeVerdict: RevisionLog | null = null;
      for (let i = sorted.length - 1; i >= 0; i--) {
        const entry = sorted[i];
        if (entry.action !== "Approved" && entry.action !== "Requested Changes")
          continue;
        const uid =
          entry.user && "id" in entry.user ? entry.user.id : undefined;
        if (!uid || uid !== userId) continue;
        if (retractions.has(entry)) continue;
        activeVerdict = entry;
        break;
      }
      return {
        blocks: buildTimelineBlocks(sorted, collapseFilter),
        verdictRetractions: retractions,
        activeVerdictForCurrentUser: activeVerdict,
      };
    }, [logs, userId, collapseFilter]);

  const renderRow = (log: RevisionLog, key: string) => (
    <RevisionLogRow
      log={log}
      key={key}
      onEditComment={onEditComment}
      onDeleteComment={onDeleteComment}
      retraction={verdictRetractions.get(log) ?? null}
      onRetractVerdict={
        onRetractVerdict && log === activeVerdictForCurrentUser
          ? onRetractVerdict
          : undefined
      }
    />
  );

  // A date-labelled timeline node: commit marker, date header, rows.
  const renderDateGroup = (group: TimelineDateGroup, key: string) => (
    <Box
      key={key}
      pl="5"
      pt="3"
      style={{
        position: "relative",
        borderLeft: "2px solid var(--gray-4)",
      }}
    >
      <Box
        style={{
          // top = the group's 12px top padding + (date line-height 16 −
          // icon 16) / 2, centering the marker on the date's line box.
          position: "absolute",
          left: -8,
          top: 12,
          color: "var(--gray-8)",
          fontSize: 16,
          display: "flex",
        }}
      >
        <PiGitCommit />
      </Box>
      <Text size="small" weight="semibold" color="text-mid" mb="3" as="div">
        {group.date}
      </Text>
      <Flex direction="column" gap="3">
        {group.logs.map(({ log, key: k }) => renderRow(log, k))}
      </Flex>
    </Box>
  );

  return (
    <Box>
      {blocks.length > 0 ? (
        // Rail center sits at 16px (15px padding + half the 2px border) so
        // the line runs through the center of the 32px md avatars, including
        // the comment composer's avatar below the timeline.
        <Box style={{ paddingLeft: 15 }}>
          {blocks.map((block) => {
            if (block.type === "date") {
              // Keyed by the first entry, not the date label — a date split
              // by a collapsed run produces two blocks with the same date.
              return renderDateGroup(block, block.logs[0].key);
            }
            const isOpen = expandedRuns.has(block.id);
            const n = block.groups.reduce((sum, g) => sum + g.logs.length, 0);
            return (
              <React.Fragment key={block.id}>
                <Box
                  pl="5"
                  py="3"
                  style={{ borderLeft: "2px solid var(--gray-4)" }}
                >
                  <Button
                    variant="ghost"
                    color="gray"
                    size="xs"
                    mt="0"
                    mb="0"
                    icon={isOpen ? <PiCaretDown /> : <PiCaretRight />}
                    onClick={() =>
                      setExpandedRuns((prev) => {
                        const next = new Set(prev);
                        if (next.has(block.id)) next.delete(block.id);
                        else next.add(block.id);
                        return next;
                      })
                    }
                  >
                    {n} other event{n === 1 ? "" : "s"}
                  </Button>
                </Box>
                {isOpen &&
                  block.groups.map((g) =>
                    renderDateGroup(g, `${block.id}-${g.date}`),
                  )}
              </React.Fragment>
            );
          })}
        </Box>
      ) : (
        <Text as="p" color="text-low" fontStyle="italic" mt="3">
          {emptyText}
        </Text>
      )}
    </Box>
  );
}
