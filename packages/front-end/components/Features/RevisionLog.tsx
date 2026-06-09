import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { FaCodeCommit } from "react-icons/fa6";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  PiChatCircleTextFill,
  PiCheckCircleFill,
  PiClockFill,
  PiGearFill,
  PiPencilSimpleFill,
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
import Code from "@/components/SyntaxHighlighting/Code";
import Markdown from "@/components/Markdown/Markdown";
import CommentCard from "@/components/Comments/CommentCard";
import CommentComposer from "@/components/Comments/CommentComposer";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";

export type MutateLog = {
  mutateLog: () => Promise<void>;
};

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  ref?: MutableRefObject<unknown>;
  reviewOnly?: boolean;
}

const REVIEW_ACTIONS = new Set([
  "Review Requested",
  "Approved",
  "Requested Changes",
  "Comment",
  "edit comment",
]);

// Only first-class user comments are mutable. Everything else — review
// verdicts, review requests, audit events — has no edit/delete affordance.
// Must match the AUTHOR_MANAGED_ACTIONS set on the backend
// (FeatureRevisionLogModel).
const AUTHOR_MANAGED_ACTIONS = new Set(["Comment"]);

// Per-action visual config, GitHub-PR style: only entries with readable
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

// Icons and colors mirror the revision status presentation in
// RevisionStatusBadge (`revisionStatusIcon` / `revisionStatusColor`) so the
// timeline and the actions-column header speak the same visual language:
// approved = grass check, changes requested = amber chat bubble,
// review requested (→ pending-review) = orange clock.
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
        color: "grass",
        verb: "approved these changes",
        icon: <PiCheckCircleFill />,
        showCommentBody: true,
        showAuditDetails: false,
      };
    case "Requested Changes":
      return {
        color: "amber",
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
    default:
      return {
        color: "gray",
        verb: action.toLowerCase(),
        icon: <PiGearFill />,
        showCommentBody: false,
        showAuditDetails: true,
      };
  }
}

export function RevisionLogRow({
  log,
  featureId,
  version,
  onMutate,
}: {
  log: RevisionLog;
  first?: boolean;
  featureId?: string;
  version?: number;
  onMutate?: () => Promise<unknown> | void;
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

  // The current user owns the entry, the entry is author-managed, and we have
  // the wiring (logId + featureId + version) to call the API. Verdicts and
  // audit-trail events are immutable; only plain Comment entries are editable
  // /deletable here.
  const logUserId =
    log.user && "id" in log.user ? (log.user as { id: string }).id : null;
  const canManageOwn =
    !!log.id &&
    !!featureId &&
    version !== undefined &&
    AUTHOR_MANAGED_ACTIONS.has(log.action) &&
    logUserId !== null &&
    logUserId === userId;

  if (editing && canManageOwn) {
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

  // GitHub-PR style presentation split: entries with readable content (a
  // markdown comment) render as full cards; everything else — review
  // requests, verdicts without a comment, notes edits, system audit events —
  // renders as a compact one-line timeline event with a semantic icon. This
  // keeps the visual weight on the conversation and makes lifecycle events
  // scannable instead of comment-shaped.
  const renderAsCard = visual.showCommentBody && !!comment;

  if (renderAsCard) {
    return (
      <CommentCard
        user={log.user}
        metadata={`${visual.verb} on ${datetime(log.timestamp)}`}
        stripeColor={visual.color}
        actions={
          canManageOwn ? (
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
              <DropdownMenuItem onClick={() => setEditing(true)}>
                Edit
              </DropdownMenuItem>
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
            </DropdownMenu>
          ) : undefined
        }
        body={<Markdown className="speech-bubble">{comment}</Markdown>}
      />
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
        <Text size="small" color="text-mid">
          <Text size="inherit" weight="medium" color="text-high">
            <EventUser user={log.user} display="name" size="sm" />
          </Text>{" "}
          {visual.verb}{" "}
          <Text size="inherit" color="text-low">
            on {datetime(log.timestamp)}
          </Text>
        </Text>
        {showDetails && (
          <Box
            asChild
            style={{ cursor: "pointer", userSelect: "none" }}
            onClick={() => setOpen((o) => !o)}
          >
            <span>
              <Text size="small" color="text-low">
                {open ? <FaAngleDown /> : <FaAngleRight />} Details
              </Text>
            </span>
          </Box>
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
  { feature, revision, reviewOnly },
  ref,
) => {
  const { data, error, mutate } = useApi<{ log: RevisionLog[] }>(
    `/feature/${feature.id}/${revision.version}/log`,
  );
  useImperativeHandle(ref, () => ({
    async mutateLog() {
      await mutate();
    },
  }));

  const logs = useMemo(() => {
    if (!data) return {};
    const filtered = reviewOnly
      ? data.log.filter((l) => REVIEW_ACTIONS.has(l.action))
      : data.log;
    const sorted = [...filtered].sort((a, b) =>
      (b.timestamp as unknown as string).localeCompare(
        a.timestamp as unknown as string,
      ),
    );
    const byDate: Record<string, RevisionLog[]> = {};
    sorted.forEach((log) => {
      const d = date(log.timestamp);
      byDate[d] = byDate[d] || [];
      byDate[d].push(log);
    });
    return byDate;
  }, [data, reviewOnly]);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const hasEntries = Object.keys(logs).length > 0;

  return (
    <Box>
      {hasEntries ? (
        <Box pl="2">
          {Object.entries(logs).map(([d, entries]) => (
            <Box
              key={d}
              pl="3"
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
                  />
                ))}
              </Flex>
            </Box>
          ))}
        </Box>
      ) : (
        <Text as="p" color="text-low" fontStyle="italic">
          {reviewOnly
            ? "No review activity yet."
            : "No history for this revision."}
        </Text>
      )}
    </Box>
  );
};
export default React.forwardRef(Revisionlog);
