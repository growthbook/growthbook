import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Revision } from "shared/enterprise";
import { ago, date } from "shared/dates";
import {
  PiChatCircleTextFill,
  PiCheckBold,
  PiGitMergeBold,
  PiPencil,
  PiPlusMinusBold,
  PiProhibit,
  PiArrowCounterClockwise,
  PiPlusBold,
} from "react-icons/pi";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Avatar from "@/ui/Avatar";
import Button from "@/ui/Button";
import { RadixColor } from "@/ui/HelperText";
import EventUser from "@/components/Avatar/EventUser";
import { useUser } from "@/services/UserContext";
import MarkdownWithDiffRefs from "@/components/Reviews/DiffCommentMarkdown";
import { ExpandableDiff } from "@/components/Reviews/Feature/RevisionDiffUtils";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { useRevisionDiff, RevisionDiffConfig } from "./useRevisionDiff";
import { buildPerEntryDiffSnapshots } from "./revisionActivityDiff";

type EntryKind =
  | "comment"
  | "approved"
  | "changes-requested"
  | "edit"
  | "lifecycle";

type TimelineEntry = {
  id: string;
  userId: string;
  timestamp: string;
  kind: EntryKind;
  // Short inline description ("approved these changes", "published this
  // revision"). Comment entries render a card with the markdown body instead.
  label: string;
  body?: string;
  icon: React.ReactNode;
  color: RadixColor;
  // Set for content-changing activity entries that recorded a per-entry
  // snapshot — enables the "Details" disclosure with the per-edit diff.
  detailId?: string;
};

// Activity actions that duplicate entries already surfaced from `reviews[]`.
const REVIEW_DUPLICATE_ACTIONS = new Set([
  "reviewed",
  "commented",
  "approved",
  "requested-changes",
]);

function activityEntry(
  a: Revision["activityLog"][number],
): Omit<TimelineEntry, "id" | "userId" | "timestamp"> | null {
  switch (a.action) {
    case "created":
      return {
        kind: "lifecycle",
        label: "created this revision",
        icon: <PiPlusBold />,
        color: "violet",
      };
    case "updated":
      return {
        kind: "edit",
        label: a.description || "updated the proposed changes",
        icon: <PiPencil />,
        color: "gray",
      };
    case "merged":
      return {
        kind: "lifecycle",
        label: "published this revision",
        icon: <PiGitMergeBold />,
        color: "violet",
      };
    case "discarded":
      return {
        kind: "lifecycle",
        label: "discarded this revision",
        icon: <PiProhibit />,
        color: "gray",
      };
    case "reopened":
      // The model uses "reopened" for every transition back into an editable
      // state, with a description that says which one (submitted for review,
      // returned to draft, approval reset, reopened after discard).
      return {
        kind: "lifecycle",
        label: a.description || "reopened this revision",
        icon: <PiArrowCounterClockwise />,
        color: "blue",
      };
    default:
      return null;
  }
}

// Chronological activity timeline for a generic (RevisionModel-backed)
// revision, built from the baked `reviews[]` and `activityLog[]`. Comments
// render as cards (markdown, diff-ref blocks upgraded to interactive
// widgets); verdicts and lifecycle events render as compact inline rows.
// `collapseEdits` (the Conversation sub-tab) folds content-edit entries into
// a single expandable "N edits" row so the conversation stays in front.
export default function RevisionTimeline<T>({
  revision,
  collapseEdits = false,
  diffConfig,
}: {
  revision: Revision;
  collapseEdits?: boolean;
  // When provided, content-changing entries get a "Details" disclosure
  // showing the per-edit before/after diff (reconstructed from the entry's
  // persisted snapshots).
  diffConfig?: RevisionDiffConfig<T>;
}) {
  const { users, getUserDisplay } = useUser();
  const [editsExpanded, setEditsExpanded] = useState(false);
  // Entry ids whose "Details" diff is expanded.
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set());

  const entries = useMemo<TimelineEntry[]>(() => {
    const list: TimelineEntry[] = [];
    for (const r of revision.reviews) {
      const timestamp = new Date(r.dateCreated).toISOString();
      if (r.decision === "comment") {
        list.push({
          id: r.id,
          userId: r.userId,
          timestamp,
          kind: "comment",
          label: "commented",
          body: r.comment,
          icon: <PiChatCircleTextFill />,
          color: "violet",
        });
      } else {
        list.push({
          id: r.id,
          userId: r.userId,
          timestamp,
          kind: r.decision === "approve" ? "approved" : "changes-requested",
          label:
            r.decision === "approve"
              ? "approved these changes"
              : "requested changes",
          body: r.comment,
          icon:
            r.decision === "approve" ? <PiCheckBold /> : <PiPlusMinusBold />,
          color: r.decision === "approve" ? "green" : "red",
        });
      }
    }
    for (const a of revision.activityLog) {
      if (REVIEW_DUPLICATE_ACTIONS.has(a.action)) continue;
      const mapped = activityEntry(a);
      if (!mapped) continue;
      list.push({
        id: a.id,
        userId: a.userId,
        timestamp: new Date(a.dateCreated).toISOString(),
        ...mapped,
        // Content-changing entries persist a proposedChangesSnapshot; those
        // are the ones a per-entry diff can be reconstructed for.
        ...(Array.isArray(a.proposedChangesSnapshot) ? { detailId: a.id } : {}),
      });
    }
    return list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [revision.reviews, revision.activityLog]);

  const hiddenEditCount = collapseEdits
    ? entries.filter((e) => e.kind === "edit").length
    : 0;
  const visible =
    collapseEdits && !editsExpanded
      ? entries.filter((e) => e.kind !== "edit")
      : entries;

  if (entries.length === 0) return null;

  // Group by day, preserving chronological order.
  const groups: { day: string; items: TimelineEntry[] }[] = [];
  for (const entry of visible) {
    const day = date(entry.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(entry);
    else groups.push({ day, items: [entry] });
  }

  const renderUserName = (userId: string) => {
    const u = users.get(userId);
    return u?.name || u?.email || getUserDisplay(userId) || "Unknown";
  };

  return (
    <Box>
      {hiddenEditCount > 0 && (
        <Box mb="2">
          <Link
            onClick={(e) => {
              e.preventDefault();
              setEditsExpanded((v) => !v);
            }}
            style={{ cursor: "pointer" }}
          >
            <Text size="small">
              {editsExpanded
                ? "Hide content edits"
                : `Show ${hiddenEditCount} content edit${
                    hiddenEditCount === 1 ? "" : "s"
                  }`}
            </Text>
          </Link>
        </Box>
      )}
      <Flex direction="column" gap="3">
        {groups.map(({ day, items }) => (
          <Box key={day}>
            <Text size="small" color="text-low" as="p" mb="2">
              {day}
            </Text>
            <Flex direction="column" gap="3">
              {items.map((entry) => {
                const name = renderUserName(entry.userId);
                const showDetails = !!entry.detailId && !!diffConfig;
                const detailsOpen = showDetails && openDetails.has(entry.id);
                const header = (
                  <Flex align="center" gap="2">
                    <Avatar size="sm" color={entry.color} variant="soft">
                      <>{entry.icon}</>
                    </Avatar>
                    <Text size="small" color="text-high" weight="medium">
                      {name}
                    </Text>
                    <Text size="small" color="text-mid">
                      {entry.label}
                    </Text>
                    <Text size="small" color="text-low">
                      {ago(entry.timestamp)}
                    </Text>
                    {showDetails && (
                      <Button
                        variant="ghost"
                        color="gray"
                        size="xs"
                        mt="0"
                        mb="0"
                        icon={detailsOpen ? <FaAngleDown /> : <FaAngleRight />}
                        onClick={() =>
                          setOpenDetails((prev) => {
                            const next = new Set(prev);
                            if (next.has(entry.id)) next.delete(entry.id);
                            else next.add(entry.id);
                            return next;
                          })
                        }
                      >
                        Details
                      </Button>
                    )}
                  </Flex>
                );
                if (!entry.body) {
                  return (
                    <Box key={entry.id}>
                      {header}
                      {detailsOpen && diffConfig && entry.detailId && (
                        <Box mt="2" ml="6">
                          <TimelineEntryDiff<T>
                            revision={revision}
                            activityId={entry.detailId}
                            diffConfig={diffConfig}
                          />
                        </Box>
                      )}
                    </Box>
                  );
                }
                return (
                  <Box
                    key={entry.id}
                    data-revision-log-id={entry.id}
                    style={{
                      border: "1px solid var(--gray-a5)",
                      borderLeft: `4px solid var(--${entry.color}-7)`,
                      borderRadius: "var(--radius-3)",
                      padding: "12px 16px",
                    }}
                  >
                    <Flex align="center" gap="2" mb="2">
                      <EventUser
                        user={{
                          type: "dashboard",
                          id: entry.userId,
                          name: users.get(entry.userId)?.name || "",
                          email: users.get(entry.userId)?.email || "",
                        }}
                        display="avatar"
                        size="sm"
                      />
                      <Text size="small" color="text-high" weight="medium">
                        {name}
                      </Text>
                      <Text size="small" color="text-mid">
                        {entry.label}
                      </Text>
                      <Text size="small" color="text-low">
                        {ago(entry.timestamp)}
                      </Text>
                    </Flex>
                    <MarkdownWithDiffRefs>{entry.body}</MarkdownWithDiffRefs>
                  </Box>
                );
              })}
            </Flex>
          </Box>
        ))}
      </Flex>
    </Box>
  );
}

// "Details" panel for a single content-changing timeline entry: the
// before/after diff of exactly what that one edit changed, reconstructed by
// replaying the per-entry snapshots (same logic as the compare modal's
// log-entry drill-down).
function TimelineEntryDiff<T>({
  revision,
  activityId,
  diffConfig,
}: {
  revision: Revision;
  activityId: string;
  diffConfig: RevisionDiffConfig<T>;
}) {
  const snapshots = useMemo(
    () => buildPerEntryDiffSnapshots<T>(revision, activityId),
    [revision, activityId],
  );
  // Fall back to the revision snapshot so the hook can run unconditionally;
  // the null check below hides the panel when no per-entry data exists.
  const fallback = revision.target.snapshot as unknown as T;
  const { diffs } = useRevisionDiff<T>(
    snapshots?.baseSnapshot ?? fallback,
    snapshots?.proposedSnapshot ?? fallback,
    diffConfig,
  );

  if (!snapshots) return null;

  if (diffs.length === 0) {
    return (
      <Text size="small" color="text-low" as="p">
        No content changes recorded for this edit.
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="2">
      {diffs.map((d, i) => (
        <ExpandableDiff
          key={i}
          title={d.label}
          a={d.a}
          b={d.b}
          defaultOpen
          styles={COMPACT_DIFF_STYLES}
        />
      ))}
    </Flex>
  );
}
