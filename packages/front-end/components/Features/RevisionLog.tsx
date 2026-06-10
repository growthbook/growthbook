import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { FaCodeCommit } from "react-icons/fa6";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  PiArrowCounterClockwiseFill,
  PiChatCircleTextFill,
  PiCheckCircleFill,
  PiClockFill,
  PiGearFill,
  PiPencilSimpleFill,
  PiProhibitFill,
} from "react-icons/pi";
import { date, datetime } from "shared/dates";
import React, {
  MutableRefObject,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import stringify from "json-stringify-pretty-compact";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import EventUser from "@/components/Avatar/EventUser";
import Avatar from "@/ui/Avatar";
import Code from "@/components/SyntaxHighlighting/Code";
import MarkdownWithDiffRefs from "@/components/Features/DiffCommentMarkdown";
import CommentCard from "@/components/Comments/CommentCard";
import CommentComposer from "@/components/Comments/CommentComposer";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export type MutateLog = {
  mutateLog: () => Promise<void>;
};

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  ref?: MutableRefObject<unknown>;
  // Called after timeline-initiated actions that mutate the revision itself
  // (e.g. retracting a verdict via the comment-card overflow). Lets the
  // parent refetch its revision data so status-dependent UI updates.
  onRevisionMutate?: () => void | Promise<void>;
}

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
  // comment` opts out because the notes already live in the Notes panel
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
  "Recall Review": "recalled their review request",
  "Undo Review": "withdrew their review",
};

function auditVerb(action: string): string {
  return (
    AUDIT_ACTION_VERBS[action] ?? `made a change (${action.toLowerCase()})`
  );
}

// Icons and colors mirror the revision status presentation in
// RevisionStatusBadge (`revisionStatusIcon` / `revisionStatusColor`) so the
// timeline and the actions-column header speak the same visual language:
// approved = grass check, changes requested = red chat bubble,
// review requested (→ pending-review) = orange clock,
// discard = gray prohibit (matches the Discarded badge's gray).
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
        verb: "approved these changes",
        icon: <PiCheckCircleFill />,
        showCommentBody: true,
        showAuditDetails: false,
      };
    case "Requested Changes":
      return {
        color: "red",
        verb: "requested changes",
        icon: <PiChatCircleTextFill />,
        showCommentBody: true,
        showAuditDetails: false,
      };
    case "Review Requested":
      return {
        color: "orange",
        verb: "requested a review",
        icon: <PiClockFill />,
        showCommentBody: false,
        showAuditDetails: false,
      };
    case "edit comment":
      return {
        color: "gray",
        verb: "edited the revision notes",
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
  featureId,
  version,
  onMutate,
  retraction,
  onRetractVerdict,
}: {
  log: RevisionLog;
  first?: boolean;
  featureId?: string;
  version?: number;
  onMutate?: () => Promise<unknown> | void;
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
  const { apiCall } = useAuth();
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

  // The current user owns the entry and we have the wiring (logId +
  // featureId + version) to call the API. Edit and delete have different
  // policies: comments can be edited or deleted, verdicts only have their
  // comment text edited (retract via Undo Review to remove the verdict).
  // Owners can still revise the comment text on a retracted verdict, e.g.
  // to clarify why they pulled back.
  const logUserId =
    log.user && "id" in log.user ? (log.user as { id: string }).id : null;
  const isOwned =
    !!log.id &&
    !!featureId &&
    version !== undefined &&
    logUserId !== null &&
    logUserId === userId;
  const canEdit = isOwned && EDITABLE_AUTHOR_ACTIONS.has(log.action);
  const canDelete = isOwned && DELETABLE_AUTHOR_ACTIONS.has(log.action);
  // Retract is offered on the user's *own* active (non-retracted) verdict
  // when the parent has wired up a handler.
  const canRetractVerdict =
    isOwned &&
    !retraction &&
    !!onRetractVerdict &&
    (log.action === "Approved" || log.action === "Requested Changes");

  if (editing && canEdit) {
    return (
      <CommentComposer
        cta="Save"
        placeholder="Add a comment…"
        initialValue={comment ?? ""}
        autofocus
        onCancel={() => setEditing(false)}
        onSubmit={async (next) => {
          await apiCall(`/feature/${featureId}/${version}/log/${log.id}`, {
            method: "PUT",
            body: JSON.stringify({ comment: next }),
          });
          setEditing(false);
          await onMutate?.();
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
    <Avatar size="sm" color={verdictAvatarColor} variant="solid">
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
                {canDelete && (
                  <DropdownMenuItem
                    color="red"
                    confirmation={{
                      confirmationTitle: "Delete Comment",
                      cta: "Delete",
                      submit: async () => {
                        await apiCall(
                          `/feature/${featureId}/${version}/log/${log.id}`,
                          { method: "DELETE" },
                        );
                        await onMutate?.();
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
            <MarkdownWithDiffRefs className="speech-bubble">
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
        <Flex
          align="center"
          justify="center"
          flexShrink="0"
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: `var(--${visual.color}-a3)`,
            color: `var(--${visual.color}-11)`,
            fontSize: 14,
          }}
        >
          {visual.icon}
        </Flex>
        <Text size="small" color="text-high">
          <Text size="inherit" weight="medium">
            <EventUser user={log.user} display="name" size="sm" />
          </Text>{" "}
          {visual.verb}{" "}
          <Text size="inherit" color="text-low">
            on {datetime(log.timestamp)}
          </Text>
        </Text>
        {showDetails && (
          <Button
            variant="ghost"
            color="gray"
            size="xs"
            mt="0"
            mb="0"
            icon={open ? <FaAngleDown /> : <FaAngleRight />}
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

const Revisionlog: React.ForwardRefRenderFunction<MutateLog, Props> = (
  { feature, revision, onRevisionMutate },
  ref,
) => {
  const { data, error, mutate } = useApi<{ log: RevisionLog[] }>(
    `/feature/${feature.id}/${revision.version}/log`,
  );
  const { apiCall } = useAuth();
  const { userId } = useUser();
  useImperativeHandle(ref, () => ({
    async mutateLog() {
      await mutate();
    },
  }));

  const { logs, verdictRetractions, activeVerdictForCurrentUser } =
    useMemo(() => {
      if (!data)
        return {
          logs: {},
          verdictRetractions: new WeakMap<RevisionLog, VerdictRetraction>(),
          activeVerdictForCurrentUser: null as RevisionLog | null,
        };
      // Chronological (newest at the bottom) — the comment composer sits
      // below the timeline, where new entries append.
      const sorted = [...data.log].sort((a, b) =>
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
      const byDate: Record<string, RevisionLog[]> = {};
      sorted.forEach((log) => {
        const d = date(log.timestamp);
        byDate[d] = byDate[d] || [];
        byDate[d].push(log);
      });
      return {
        logs: byDate,
        verdictRetractions: retractions,
        activeVerdictForCurrentUser: activeVerdict,
      };
    }, [data, userId]);

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const hasEntries = Object.keys(logs).length > 0;

  return (
    <Box>
      {hasEntries ? (
        <Box style={{ paddingLeft: 11 }}>
          {Object.entries(logs).map(([d, entries]) => (
            <Box
              key={d}
              pl="5"
              pt="3"
              style={{
                position: "relative",
                borderLeft: "2px solid var(--gray-4)",
              }}
            >
              <Box
                style={{
                  position: "absolute",
                  left: -7,
                  top: 8,
                  color: "var(--gray-8)",
                }}
              >
                <FaCodeCommit />
              </Box>
              <Text
                size="small"
                weight="semibold"
                color="text-mid"
                mb="3"
                as="div"
              >
                {d}
              </Text>
              <Flex direction="column" gap="3">
                {entries.map((log, i) => (
                  <RevisionLogRow
                    log={log}
                    key={log.id ?? i}
                    featureId={feature.id}
                    version={revision.version}
                    onMutate={mutate}
                    retraction={verdictRetractions.get(log) ?? null}
                    onRetractVerdict={
                      log === activeVerdictForCurrentUser
                        ? async () => {
                            await apiCall(
                              `/feature/${feature.id}/${revision.version}/undo-review`,
                              { method: "POST" },
                            );
                            await mutate();
                            await onRevisionMutate?.();
                          }
                        : undefined
                    }
                  />
                ))}
              </Flex>
            </Box>
          ))}
        </Box>
      ) : (
        <Text as="p" color="text-low" fontStyle="italic" mt="3">
          No history for this revision.
        </Text>
      )}
    </Box>
  );
};
export default React.forwardRef(Revisionlog);
