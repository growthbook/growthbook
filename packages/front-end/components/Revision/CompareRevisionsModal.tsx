import {
  ActivityLogEntry,
  JsonPatchOperation,
  Review,
  Revision,
  applyTopLevelPatchOps,
} from "shared/enterprise";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiArrowsLeftRightBold,
  PiCaretDownBold,
  PiCaretLeftBold,
  PiCaretRightBold,
  PiClockClockwise,
  PiWarningBold,
  PiX,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Badge from "@/ui/Badge";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { useUser } from "@/services/UserContext";
import { RevisionDiff } from "@/components/Revision/RevisionDiff";
import {
  useRevisionDiff,
  RevisionDiffConfig,
} from "@/components/Revision/useRevisionDiff";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import styles from "./CompareRevisionsModal.module.scss";

const STORAGE_KEY_PREFIX = "compare-revisions";

const ACTIVE_DRAFT_STATUSES = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
];

export interface Props<T> {
  // The live entity (used as the diff baseline/fallback); treated opaquely.
  liveEntity: T;
  // Scopes the per-entity "show discarded/drafts/merged" view preferences.
  entityId: string;
  // Entity-specific field rendering for the diff (e.g. constants vs saved groups).
  diffConfig: RevisionDiffConfig<T>;
  allRevisions: Revision[];
  currentRevisionId: string | null;
  onClose: () => void;
  // Opens directly in "preview draft vs live" mode for this revision
  initialPreviewDraft?: string;
  initialMode?: "most-recent-live";
  requiresApproval?: boolean;
}

function RevisionStatusBadge({
  revision,
  liveRevisionId,
  requiresApproval = true,
}: {
  revision: Revision | null;
  liveRevisionId: string | null;
  requiresApproval?: boolean;
}) {
  if (!revision) return null;
  return getStatusBadge(
    revision.id === liveRevisionId ? "live" : revision.status,
    requiresApproval,
  );
}

function RevisionCompareLabel({
  revA,
  revB,
  liveRevisionId,
  revAFailed = false,
  revBFailed = false,
  mb,
  mt,
  requiresApproval = true,
}: {
  revA: Revision | null;
  revB: Revision | null;
  liveRevisionId: string | null;
  revAFailed?: boolean;
  revBFailed?: boolean;
  mb?: "1" | "2" | "3" | "4";
  mt?: "1" | "2" | "3" | "4";
  requiresApproval?: boolean;
}) {
  return (
    <Flex align="center" gap="4" wrap="nowrap" mb={mb} mt={mt}>
      <Flex direction="column">
        <Flex align="center" justify="between" gap="2">
          <Flex align="center" gap="1">
            {revAFailed && (
              <Tooltip body="Could not load revision">
                <PiWarningBold
                  style={{ color: "var(--red-9)", flexShrink: 0 }}
                />
              </Tooltip>
            )}
            <Text weight="medium" size="medium">
              <OverflowText
                maxWidth={250}
                title={revisionLabelText(revA?.version ?? 0, revA?.title)}
              >
                <RevisionLabel
                  version={revA?.version ?? 0}
                  title={revA?.title}
                  minWidth={0}
                  numberSize="inherit"
                />
              </OverflowText>
            </Text>
          </Flex>
          <RevisionStatusBadge
            revision={revA}
            liveRevisionId={liveRevisionId}
            requiresApproval={requiresApproval}
          />
        </Flex>
        {revA && (
          <Text as="div" size="small" color="text-low">
            {datetime(revA.dateUpdated)}
          </Text>
        )}
      </Flex>
      <PiArrowsLeftRightBold size={16} />
      <Flex direction="column">
        <Flex align="center" justify="between" gap="2">
          <Flex align="center" gap="1">
            {revBFailed && (
              <Tooltip body="Could not load revision">
                <PiWarningBold
                  style={{ color: "var(--red-9)", flexShrink: 0 }}
                />
              </Tooltip>
            )}
            <Text weight="medium" size="medium">
              <OverflowText
                maxWidth={250}
                title={revisionLabelText(revB?.version ?? 0, revB?.title)}
              >
                <RevisionLabel
                  version={revB?.version ?? 0}
                  title={revB?.title}
                  minWidth={0}
                  numberSize="inherit"
                />
              </OverflowText>
            </Text>
          </Flex>
          <RevisionStatusBadge
            revision={revB}
            liveRevisionId={liveRevisionId}
            requiresApproval={requiresApproval}
          />
        </Flex>
        {revB && (
          <Text as="div" size="small" color="text-low">
            {datetime(revB.dateUpdated)}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}

// Combined activity timeline for a single revision — merges the revision's
// `reviews` and `activityLog` arrays into one chronologically ordered list.
// Filters out lifecycle entries that double up with a review entry (reviewed,
// commented, approved, requested-changes) so nothing appears twice.
type ActivityTimelineItem =
  | {
      type: "review";
      id: string;
      userId: string;
      createdAt: Date;
      decision: Review["decision"];
      comment: string | null;
    }
  | {
      type: "activity";
      id: string;
      userId: string;
      createdAt: Date;
      action: ActivityLogEntry["action"];
      description: string | null;
      // Persisted only on content-changing actions (created / updated /
      // rebased). Used to reconstruct a per-entry diff in the log-entry
      // detail panel.
      proposedChangesSnapshot: JsonPatchOperation[] | null;
      targetSnapshot: unknown;
    };

function buildActivityTimeline(revision: Revision): ActivityTimelineItem[] {
  const items: ActivityTimelineItem[] = [
    ...revision.reviews.map((r) => ({
      type: "review" as const,
      id: r.id,
      userId: r.userId,
      createdAt: new Date(r.dateCreated),
      decision: r.decision,
      comment: r.comment ?? null,
    })),
    ...revision.activityLog
      .filter(
        (a) =>
          !["reviewed", "commented", "approved", "requested-changes"].includes(
            a.action,
          ),
      )
      .map((a) => ({
        type: "activity" as const,
        id: a.id,
        userId: a.userId,
        createdAt: new Date(a.dateCreated),
        action: a.action,
        description: a.description ?? null,
        proposedChangesSnapshot: a.proposedChangesSnapshot ?? null,
        targetSnapshot: a.targetSnapshot,
      })),
  ];
  items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return items;
}

// Reconstruct the state on either side of a single activity-log entry by
// replaying the per-entry snapshots in chronological order. Returns `null`
// for entries that didn't change content (e.g. merged/discarded/reopened,
// or any entry from a revision created before per-entry snapshots were
// persisted).
function buildPerEntryDiffSnapshots<T extends Record<string, unknown>>(
  revision: Revision,
  activityId: string,
): {
  baseSnapshot: T;
  proposedSnapshot: T;
} | null {
  const contentEntries = revision.activityLog
    .filter((e) => Array.isArray(e.proposedChangesSnapshot))
    .slice()
    .sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );
  const targetIdx = contentEntries.findIndex((e) => e.id === activityId);
  if (targetIdx === -1) return null;

  // Initial baseline = first content entry's targetSnapshot if captured
  // ("created" entry stores this), else fall back to the revision's current
  // `target.snapshot` (best-effort for revisions created before this field
  // existed and which haven't been rebased).
  let runningBaseline: T =
    (contentEntries[0]?.targetSnapshot as unknown as T | undefined) ??
    (revision.target.snapshot as unknown as T);
  let runningProposed: JsonPatchOperation[] = [];

  for (let i = 0; i <= targetIdx; i++) {
    const entry = contentEntries[i];
    if (i === targetIdx) {
      const beforeSnapshot = applyTopLevelPatchOps(
        runningBaseline,
        runningProposed,
      ) as T;
      const afterBaseline =
        (entry.targetSnapshot ?? null) !== null
          ? (entry.targetSnapshot as unknown as T)
          : runningBaseline;
      const afterSnapshot = applyTopLevelPatchOps(
        afterBaseline,
        (entry.proposedChangesSnapshot ?? []) as JsonPatchOperation[],
      ) as T;
      return { baseSnapshot: beforeSnapshot, proposedSnapshot: afterSnapshot };
    }
    if ((entry.targetSnapshot ?? null) !== null) {
      runningBaseline = entry.targetSnapshot as unknown as T;
    }
    runningProposed = (entry.proposedChangesSnapshot ??
      []) as JsonPatchOperation[];
  }
  return null;
}

function activityLabel(item: ActivityTimelineItem): string {
  if (item.type === "review") {
    switch (item.decision) {
      case "approve":
        return "Approved changes";
      case "request-changes":
        return "Requested changes";
      case "comment":
        return "Commented";
      default:
        return "Review";
    }
  }
  switch (item.action) {
    case "created":
      return "Revision created";
    case "updated":
      return "Revision updated";
    case "merged":
      return "Merged";
    case "discarded":
      return "Discarded";
    case "reopened":
      return "Reopened";
    default:
      return item.action;
  }
}

function LogEntryPanel({
  item,
  userDisplay,
  diff,
  diffMode,
}: {
  item: ActivityTimelineItem;
  userDisplay: string;
  // Diff to render in the panel. `null` means hide the diff section
  // entirely (e.g. lifecycle entries such as merged / discarded / reopened
  // and reviews — nothing content-wise changed).
  diff: {
    // Diff result types don't depend on the entity type, so a concrete arg here
    // keeps this top-level component non-generic.
    diffs: ReturnType<typeof useRevisionDiff<Record<string, unknown>>>["diffs"];
    badges: ReturnType<
      typeof useRevisionDiff<Record<string, unknown>>
    >["badges"];
    customRenderGroups: ReturnType<
      typeof useRevisionDiff<Record<string, unknown>>
    >["customRenderGroups"];
  } | null;
  // "per-entry" — the diff isolates exactly what this one action changed.
  // "cumulative" — fallback for legacy entries (no per-entry snapshot
  // recorded) — shows the whole revision's proposed changes.
  diffMode: "per-entry" | "cumulative";
}) {
  const rows: [string, React.ReactNode][] = [
    [
      "Author",
      <Flex align="center" gap="2" key="author">
        <UserAvatar name={userDisplay} size="sm" variant="soft" />
        <Text>{userDisplay}</Text>
      </Flex>,
    ],
    ["Date", datetime(item.createdAt)],
  ];

  const comment = item.type === "review" ? item.comment : item.description;

  return (
    <Box>
      <Heading as="h4" size="small" mb="3">
        {activityLabel(item)}
      </Heading>
      <Flex direction="column" gap="2">
        {rows.map(([label, value]) => (
          <Flex key={label} align="center" gap="3">
            <span style={{ minWidth: 72, flexShrink: 0 }}>
              <Text color="text-mid">{label}</Text>
            </span>
            {value}
          </Flex>
        ))}
        {comment ? (
          <Flex align="start" gap="3" mt="2">
            <span style={{ minWidth: 72, flexShrink: 0 }}>
              <Text color="text-mid">Comment</Text>
            </span>
            <Box
              pl="2"
              style={{ borderLeft: "2px solid var(--gray-a4)", flex: 1 }}
            >
              <Text as="p" color="text-mid" mb="0">
                {comment}
              </Text>
            </Box>
          </Flex>
        ) : null}
      </Flex>
      {diff ? (
        <Box mt="4">
          <Heading as="h5" size="small" color="text-mid" mb="2">
            {diffMode === "per-entry"
              ? "Changes in this entry"
              : "Cumulative changes in this revision"}
          </Heading>
          {diffMode === "cumulative" ? (
            <Text as="p" size="small" color="text-low" mb="2">
              Per-entry changes weren&apos;t recorded for this revision, so
              we&apos;re showing the cumulative diff for the whole revision
              instead.
            </Text>
          ) : null}
          {diff.diffs.length === 0 ? (
            <Text color="text-low">
              {diffMode === "per-entry"
                ? "This entry did not change any content."
                : "No changes proposed in this revision."}
            </Text>
          ) : (
            <RevisionDiff
              diffs={diff.diffs}
              badges={diff.badges}
              customRenderGroups={diff.customRenderGroups}
            />
          )}
        </Box>
      ) : null}
    </Box>
  );
}

export default function CompareRevisionsModal<
  T extends Record<string, unknown>,
>({
  liveEntity,
  entityId,
  diffConfig,
  allRevisions,
  currentRevisionId,
  onClose,
  initialPreviewDraft,
  initialMode,
  requiresApproval = true,
}: Props<T>) {
  // Find the live revision (most recent merged)
  const liveRevision = useMemo(() => {
    return [...allRevisions]
      .filter((r) => r.status === "merged")
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];
  }, [allRevisions]);

  const liveRevisionId = liveRevision?.id || null;

  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:${entityId}:showDiscarded`,
    false,
  );
  const [showDrafts, setShowDrafts] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:${entityId}:showDrafts`,
    true,
  );
  const [showMerged, setShowMerged] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:${entityId}:showMerged`,
    true,
  );
  const [diffViewModeRaw, setDiffViewModeRaw] = useLocalStorage<string>(
    `${STORAGE_KEY_PREFIX}:${entityId}:diffViewMode`,
    "steps",
  );
  const diffViewMode = diffViewModeRaw === "single" ? "single" : "steps";

  // Map revisions by ID for quick lookup
  const revisionById = useMemo(
    () => new Map(allRevisions.map((r) => [r.id, r])),
    [allRevisions],
  );

  // Sort by creation date (oldest first) to get consistent ordering
  const sortedRevisionsAsc = useMemo(() => {
    return [...allRevisions].sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );
  }, [allRevisions]);

  // Build list of revision IDs in descending order for display
  const filteredRevisionList = useMemo(() => {
    return sortedRevisionsAsc
      .filter((r) => {
        if (r.status === "merged" && !showMerged) return false;
        if (r.status === "discarded" && !showDiscarded) return false;
        if (ACTIVE_DRAFT_STATUSES.includes(r.status) && !showDrafts)
          return false;
        return true;
      })
      .reverse(); // Show newest first
  }, [sortedRevisionsAsc, showDiscarded, showDrafts, showMerged]);

  const revisionsDesc = useMemo(() => {
    return filteredRevisionList.map((r) => r.id);
  }, [filteredRevisionList]);

  // Compute default comparison target
  const defaultAdjacentId = useMemo(() => {
    const allDesc = [...sortedRevisionsAsc]
      .filter((r) => r.status !== "discarded")
      .reverse()
      .map((r) => r.id);
    if (allDesc.length < 2) return null;
    const idx = allDesc.indexOf(currentRevisionId || "");
    if (idx < 0) return allDesc[1] ?? allDesc[0];
    if (idx === allDesc.length - 1) return allDesc[idx - 1] ?? null;
    return allDesc[idx + 1];
  }, [sortedRevisionsAsc, currentRevisionId]);

  const [selectedRevisionIds, setSelectedRevisionIds] = useState<string[]>(
    () => {
      // Helper to sort IDs in chronological order (oldest first)
      const sortIds = (ids: string[]) => {
        return [...ids].sort((a, b) => {
          const aIdx = sortedRevisionsAsc.findIndex((r) => r.id === a);
          const bIdx = sortedRevisionsAsc.findIndex((r) => r.id === b);
          return aIdx - bIdx;
        });
      };

      if (initialMode === "most-recent-live") {
        const mergedAsc = sortedRevisionsAsc
          .filter((r) => r.status === "merged")
          .map((r) => r.id);
        const prevLive =
          mergedAsc.filter((id) => id !== liveRevisionId).at(-1) ?? null;
        if (prevLive !== null && liveRevisionId)
          return sortIds([prevLive, liveRevisionId]);
      }
      if (!defaultAdjacentId || !currentRevisionId)
        return currentRevisionId ? [currentRevisionId] : [];
      return sortIds([currentRevisionId, defaultAdjacentId]);
    },
  );

  // Apply filter flags for initial mode
  const initialModeApplied = useRef(false);
  useEffect(() => {
    if (initialMode === "most-recent-live" && !initialModeApplied.current) {
      initialModeApplied.current = true;
      setShowDrafts(false);
      setShowDiscarded(false);
      setShowMerged(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [previewDraftId, setPreviewDraftId] = useState<string | null>(
    initialPreviewDraft ?? null,
  );

  // Audit-history drill-down state: which sidebar rows are expanded, and
  // (optionally) which individual activity entry is being previewed in the
  // right-hand panel.
  const [expandedRevisionIds, setExpandedRevisionIds] = useState<Set<string>>(
    new Set(),
  );
  const [activeActivity, setActiveActivity] = useState<{
    revisionId: string;
    activityId: string;
  } | null>(null);

  // Pre-compute the combined reviews + activityLog timeline for every
  // revision once. This is cheap — both arrays are already on the revision.
  const activityTimelinesById = useMemo(() => {
    const map = new Map<string, ActivityTimelineItem[]>();
    for (const rev of allRevisions) {
      map.set(rev.id, buildActivityTimeline(rev));
    }
    return map;
  }, [allRevisions]);

  const { getUserDisplay } = useUser();

  // Compute selected revisions sorted by creation date
  const selectedSorted = useMemo(() => {
    if (selectedRevisionIds.length < 2) {
      return selectedRevisionIds;
    }
    const lo = selectedRevisionIds[0];
    const hi = selectedRevisionIds[selectedRevisionIds.length - 1];
    const loIdx = sortedRevisionsAsc.findIndex((r) => r.id === lo);
    const hiIdx = sortedRevisionsAsc.findIndex((r) => r.id === hi);

    if (loIdx === -1 || hiIdx === -1) return selectedRevisionIds;

    const [minIdx, maxIdx] = loIdx < hiIdx ? [loIdx, hiIdx] : [hiIdx, loIdx];
    const inRange = new Set<string>(selectedRevisionIds);

    // Include all filtered revisions between the selected endpoints
    filteredRevisionList.forEach((r) => {
      const idx = sortedRevisionsAsc.findIndex((sr) => sr.id === r.id);
      if (idx >= minIdx && idx <= maxIdx) {
        inRange.add(r.id);
      }
    });

    return sortedRevisionsAsc.filter((r) => inRange.has(r.id)).map((r) => r.id);
  }, [selectedRevisionIds, filteredRevisionList, sortedRevisionsAsc]);

  const selectedSortedSet = useMemo(
    () => new Set(selectedSorted),
    [selectedSorted],
  );

  // The sidebar always shows the filtered list plus any selected/preview revisions
  const sidebarRevisionsDesc = useMemo(() => {
    const alwaysVisible = new Set<string>(selectedRevisionIds);
    if (previewDraftId !== null) alwaysVisible.add(previewDraftId);
    const extra = allRevisions.filter(
      (r) =>
        alwaysVisible.has(r.id) &&
        !filteredRevisionList.some((fr) => fr.id === r.id),
    );
    return [...filteredRevisionList, ...extra]
      .sort(
        (a, b) =>
          new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
      )
      .map((r) => r.id);
  }, [filteredRevisionList, allRevisions, selectedRevisionIds, previewDraftId]);

  const steps = useMemo(() => {
    const pairs: [string, string][] = [];
    for (let i = 0; i < selectedSorted.length - 1; i++) {
      pairs.push([selectedSorted[i], selectedSorted[i + 1]]);
    }
    return pairs.reverse();
  }, [selectedSorted]);

  const [diffPage, setDiffPage] = useState(0);
  useEffect(() => {
    setDiffPage((p) =>
      steps.length === 0 ? 0 : Math.min(p, steps.length - 1),
    );
  }, [steps.length]);

  const safeDiffPage = Math.min(
    Math.max(0, diffPage),
    steps.length > 0 ? steps.length - 1 : 0,
  );

  // Helper to sort IDs in chronological order (oldest first)
  const sortByChronological = useCallback(
    (ids: string[]) => {
      return [...ids].sort((a, b) => {
        const aIdx = sortedRevisionsAsc.findIndex((r) => r.id === a);
        const bIdx = sortedRevisionsAsc.findIndex((r) => r.id === b);
        return aIdx - bIdx;
      });
    },
    [sortedRevisionsAsc],
  );

  // Compares ranges by endpoints only
  const isRangeEqual = useCallback(
    (a: string[], b: string[] | null) =>
      !!b &&
      a.length >= 2 &&
      b.length >= 2 &&
      a[0] === b[0] &&
      a[a.length - 1] === b[b.length - 1],
    [],
  );

  // Apply live quick action
  const applyLiveQuickAction = useCallback(
    (range: string[]) => {
      setPreviewDraftId(null);
      setShowDrafts(false);
      setShowDiscarded(false);
      setShowMerged(true);
      // Ensure the range is in chronological order
      setSelectedRevisionIds(sortByChronological(range));
      setDiffPage(0);
    },
    [setShowDrafts, setShowDiscarded, setShowMerged, sortByChronological],
  );

  const toggleRevision = (id: string) => {
    setPreviewDraftId(null);
    setSelectedRevisionIds((prev) => {
      const idx = revisionsDesc.indexOf(id);
      if (idx === -1) {
        // Hidden by the current filters but still selected (a stale endpoint
        // kept visible in the sidebar) — shrink the range inward to the
        // nearest visible revision using the full chronological list.
        if (!prev.includes(id) || prev.length < 2) return prev;
        const chron = sortedRevisionsAsc.map((r) => r.id);
        const lowIdx = chron.indexOf(prev[0]);
        const highIdx = chron.indexOf(prev[prev.length - 1]);
        const idIdx = chron.indexOf(id);
        if (lowIdx === -1 || highIdx === -1 || idIdx === -1) return prev;
        const visibleIds = new Set(filteredRevisionList.map((r) => r.id));
        if (idIdx === lowIdx) {
          let next = lowIdx + 1;
          while (next < highIdx && !visibleIds.has(chron[next])) next++;
          return next >= highIdx
            ? [chron[highIdx]]
            : sortByChronological([chron[next], chron[highIdx]]);
        }
        if (idIdx === highIdx) {
          let next = highIdx - 1;
          while (next > lowIdx && !visibleIds.has(chron[next])) next--;
          return next <= lowIdx
            ? [chron[lowIdx]]
            : sortByChronological([chron[lowIdx], chron[next]]);
        }
        return prev;
      }
      if (prev.length === 0) return [id];

      // Find current selection indices in display order (revisionsDesc)
      const prevIndices = prev
        .map((v) => revisionsDesc.indexOf(v))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);

      const startIdx = prevIndices[0] ?? -1; // newest selected (lowest display index)
      const endIdx = prevIndices[prevIndices.length - 1] ?? -1; // oldest selected

      // Clicking an endpoint shrinks the range to the nearest visible item inward
      if (prev.includes(id)) {
        if (startIdx === -1 || endIdx === -1 || endIdx - startIdx <= 1)
          return prev;
        const visibleIds = new Set(filteredRevisionList.map((r) => r.id));
        if (idx === startIdx) {
          let newStart = startIdx + 1;
          while (newStart < endIdx && !visibleIds.has(revisionsDesc[newStart]))
            newStart++;
          if (newStart >= endIdx) return prev; // no visible item found
          return sortByChronological([
            revisionsDesc[newStart],
            revisionsDesc[endIdx],
          ]);
        }
        if (idx === endIdx) {
          let newEnd = endIdx - 1;
          while (newEnd > startIdx && !visibleIds.has(revisionsDesc[newEnd]))
            newEnd--;
          if (newEnd <= startIdx) return prev; // no visible item found
          return sortByChronological([
            revisionsDesc[startIdx],
            revisionsDesc[newEnd],
          ]);
        }
        return prev;
      }

      if (prevIndices.length > 0) {
        // Count visible revisions strictly between two indices (exclusive of endpoints)
        const visibleIdSet = new Set(filteredRevisionList.map((r) => r.id));
        const visibleBetween = (a: number, b: number): number => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          let count = 0;
          for (let i = lo + 1; i < hi; i++) {
            if (visibleIdSet.has(revisionsDesc[i])) count++;
          }
          return count;
        };

        // Shorten range by moving the nearer endpoint; tiebreaker: move the newer one
        if (idx > startIdx && idx < endIdx) {
          const distToNewer = idx - startIdx;
          const distToOlder = endIdx - idx;
          if (distToNewer <= distToOlder) {
            return sortByChronological([
              revisionsDesc[idx],
              revisionsDesc[endIdx],
            ]);
          } else {
            return sortByChronological([
              revisionsDesc[startIdx],
              revisionsDesc[idx],
            ]);
          }
        }

        // If 8+ visible items outside the range, pair with the adjacent item instead of expanding
        if (
          (idx < startIdx && visibleBetween(idx, startIdx) >= 8) ||
          (idx > endIdx && visibleBetween(endIdx, idx) >= 8)
        ) {
          if (idx < revisionsDesc.length - 1) {
            return sortByChronological([
              revisionsDesc[idx + 1],
              revisionsDesc[idx],
            ]);
          }
          // Clicked the very last (oldest) revision — round up to the two newest
          if (revisionsDesc.length >= 2) {
            return sortByChronological([revisionsDesc[1], revisionsDesc[0]]);
          }
          return prev;
        }
      }

      // Expand the range to include the clicked revision
      // Get chronological position for comparison
      const getChronologicalIdx = (revId: string) =>
        sortedRevisionsAsc.findIndex((r) => r.id === revId);

      const sortedPrev = [...prev].sort(
        (a, b) => getChronologicalIdx(a) - getChronologicalIdx(b),
      );
      const low = sortedPrev[0];
      const high = sortedPrev[sortedPrev.length - 1];
      const idChronIdx = getChronologicalIdx(id);
      const lowChronIdx = getChronologicalIdx(low);
      const highChronIdx = getChronologicalIdx(high);

      const newLow = idChronIdx < lowChronIdx ? id : low;
      const newHigh = idChronIdx > highChronIdx ? id : high;
      // Store only the two endpoints in chronological order
      return sortByChronological([newLow, newHigh]);
    });
  };

  const hasDiscardedRevisions = useMemo(
    () => allRevisions.some((r) => r.status === "discarded"),
    [allRevisions],
  );
  const hasDraftRevisions = useMemo(
    () => allRevisions.some((r) => ACTIVE_DRAFT_STATUSES.includes(r.status)),
    [allRevisions],
  );
  const hasMergedRevisions = useMemo(
    () => allRevisions.some((r) => r.status === "merged"),
    [allRevisions],
  );

  // Use full unfiltered list for quick actions
  const mostRecentDraftId = useMemo(() => {
    const drafts = allRevisions.filter((r) =>
      ACTIVE_DRAFT_STATUSES.includes(r.status),
    );
    if (drafts.length === 0) return null;
    const sorted = drafts.sort(
      (a, b) =>
        new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
    );
    return sorted[0]?.id ?? null;
  }, [allRevisions]);

  const mergedIdsAsc = useMemo(
    () =>
      sortedRevisionsAsc.filter((r) => r.status === "merged").map((r) => r.id),
    [sortedRevisionsAsc],
  );

  const quickActionRanges = useMemo(() => {
    const draftPreviewId =
      mostRecentDraftId !== null && mostRecentDraftId !== liveRevisionId
        ? mostRecentDraftId
        : null;

    const prevLiveId =
      mergedIdsAsc.filter((id) => id !== liveRevisionId).at(-1) ?? null;
    const liveRange: [string, string] | null =
      prevLiveId !== null && liveRevisionId
        ? [prevLiveId, liveRevisionId]
        : null;

    const allRange: [string, string] | null =
      mergedIdsAsc.length >= 2
        ? [mergedIdsAsc[0], mergedIdsAsc[mergedIdsAsc.length - 1]]
        : null;

    return { draftPreviewId, liveRange, allRange };
  }, [mostRecentDraftId, liveRevisionId, mergedIdsAsc]);

  const currentStep = steps[safeDiffPage];
  const stepRevA = currentStep
    ? revisionById.get(currentStep[0]) || null
    : null;
  const stepRevB = currentStep
    ? revisionById.get(currentStep[1]) || null
    : null;

  const singleRevFirst =
    selectedSorted.length >= 2
      ? revisionById.get(selectedSorted[0]) || null
      : null;
  const singleRevLast =
    selectedSorted.length >= 2
      ? revisionById.get(selectedSorted[selectedSorted.length - 1]) || null
      : null;

  const previewLiveRev =
    previewDraftId !== null && liveRevisionId
      ? revisionById.get(liveRevisionId) || null
      : null;
  const previewDraftRev =
    previewDraftId !== null ? revisionById.get(previewDraftId) || null : null;

  // Calculate snapshots for all three diff scenarios at the top level
  const previewDraftSnapshots = useMemo(() => {
    if (!previewDraftRev) return null;
    const baseSnapshot =
      previewDraftRev.status === "merged"
        ? (previewDraftRev.target.snapshot as unknown as T)
        : liveEntity;
    const proposedSnapshot = applyTopLevelPatchOps(
      baseSnapshot,
      previewDraftRev.target.proposedChanges,
    ) as T;
    return { baseSnapshot, proposedSnapshot };
  }, [previewDraftRev, liveEntity]);

  const stepDiffSnapshots = useMemo(() => {
    if (!stepRevB) return null;
    // Both sides must share one baseline or the step shows spurious diffs.
    // A merged revision carries its own pre-merge snapshot (base = snapshot,
    // proposed = snapshot + its changes → revB's own before→after). A draft's
    // proposedChanges are relative to LIVE, so both sides use liveEntity
    // (base = live, proposed = live + changes) — matching previewDraftSnapshots.
    const baseSnapshot =
      stepRevB.status === "merged"
        ? (stepRevB.target.snapshot as unknown as T)
        : liveEntity;
    const proposedSnapshot = applyTopLevelPatchOps(
      baseSnapshot,
      stepRevB.target.proposedChanges,
    ) as T;
    return { baseSnapshot, proposedSnapshot };
  }, [stepRevB, liveEntity]);

  const singleDiffSnapshots = useMemo(() => {
    if (!singleRevLast) return null;
    // Base is the state AFTER the first revision so the diff spans the whole
    // selected range (v1↔v5 shows everything from v1's result to v5's result).
    const baseSnapshot = singleRevFirst
      ? (applyTopLevelPatchOps(
          singleRevFirst.target.snapshot as unknown as T,
          singleRevFirst.target.proposedChanges,
        ) as T)
      : liveEntity;
    // Merged revisions carry their own pre-merge snapshot; a draft's
    // proposedChanges are relative to live.
    const proposedSnapshot =
      singleRevLast.status === "merged"
        ? (applyTopLevelPatchOps(
            singleRevLast.target.snapshot as unknown as T,
            singleRevLast.target.proposedChanges,
          ) as T)
        : (applyTopLevelPatchOps(
            liveEntity,
            singleRevLast.target.proposedChanges,
          ) as T);
    return { baseSnapshot, proposedSnapshot };
  }, [singleRevFirst, singleRevLast, liveEntity]);

  // Snapshots for the "log entry" drill-down. For content-changing activity
  // entries (created / updated / rebased) that were recorded with
  // per-entry snapshots, we reconstruct the state immediately before and
  // after that specific entry so the diff shows exactly what that one
  // action changed.
  //
  // For legacy revisions (created before per-entry snapshots were
  // persisted), we fall back to the cumulative revision diff so the user
  // still gets useful context.
  //
  // For entries where no content change is associated with the action at
  // all (reviews, merged/discarded/reopened), both snapshot computations
  // return `null` and the UI hides the diff section.
  const logEntryRevision = activeActivity
    ? revisionById.get(activeActivity.revisionId) || null
    : null;

  const activeActivityItem = useMemo(() => {
    if (!activeActivity) return null;
    const timeline = activityTimelinesById.get(activeActivity.revisionId);
    return timeline?.find((i) => i.id === activeActivity.activityId) ?? null;
  }, [activeActivity, activityTimelinesById]);

  // Per-entry snapshots — preferred when the entry has per-entry data
  // recorded.
  const perEntryDiffSnapshots = useMemo(() => {
    if (!logEntryRevision || !activeActivity) return null;
    return buildPerEntryDiffSnapshots<T>(
      logEntryRevision,
      activeActivity.activityId,
    );
  }, [logEntryRevision, activeActivity]);

  // Cumulative fallback snapshots — used when per-entry data isn't
  // available but the entry is still content-related (i.e. an activity
  // entry with a "created" / "updated" action, which predates per-entry
  // snapshot persistence).
  const cumulativeFallbackSnapshots = useMemo(() => {
    if (!logEntryRevision || !activeActivityItem) return null;
    if (activeActivityItem.type !== "activity") return null;
    if (!["created", "updated"].includes(activeActivityItem.action))
      return null;
    const baseSnapshot = logEntryRevision.target.snapshot as unknown as T;
    const proposedSnapshot = applyTopLevelPatchOps(
      baseSnapshot,
      logEntryRevision.target.proposedChanges,
    ) as T;
    return { baseSnapshot, proposedSnapshot };
  }, [logEntryRevision, activeActivityItem]);

  const logEntryDiffMode: "per-entry" | "cumulative" = perEntryDiffSnapshots
    ? "per-entry"
    : "cumulative";
  const logEntryDiffSnapshots =
    perEntryDiffSnapshots ?? cumulativeFallbackSnapshots;

  // Call useRevisionDiff hooks at the top level for all scenarios
  const previewDraftDiff = useRevisionDiff<T>(
    previewDraftSnapshots?.baseSnapshot || liveEntity,
    previewDraftSnapshots?.proposedSnapshot || liveEntity,
    diffConfig,
  );

  const stepDiff = useRevisionDiff<T>(
    stepDiffSnapshots?.baseSnapshot || liveEntity,
    stepDiffSnapshots?.proposedSnapshot || liveEntity,
    diffConfig,
  );

  const singleDiff = useRevisionDiff<T>(
    singleDiffSnapshots?.baseSnapshot || liveEntity,
    singleDiffSnapshots?.proposedSnapshot || liveEntity,
    diffConfig,
  );

  const logEntryDiff = useRevisionDiff<T>(
    logEntryDiffSnapshots?.baseSnapshot || liveEntity,
    logEntryDiffSnapshots?.proposedSnapshot || liveEntity,
    diffConfig,
  );

  return (
    <Modal
      useRadixButton={false}
      trackingEventModalType="compare-revisions"
      open={true}
      header="Compare revisions"
      close={onClose}
      hideCta
      includeCloseCta
      closeCta="Close"
      size="max"
      sizeY="max"
      bodyClassName="p-0"
    >
      <Flex style={{ flex: 1, minHeight: 0 }}>
        <Box
          style={{ width: 300, minWidth: 300, minHeight: 0 }}
          className={`${styles.sidebar} ${styles.sidebarLeft} overflow-auto`}
        >
          {(quickActionRanges.draftPreviewId !== null ||
            quickActionRanges.liveRange ||
            quickActionRanges.allRange) && (
            <Box className={`${styles.section} border-bottom`} pb="2">
              <Text
                size="medium"
                weight="medium"
                color="text-mid"
                mb="2"
                as="p"
              >
                Quick actions
              </Text>
              <Flex direction="column" className={styles.quickActionsList}>
                {quickActionRanges.draftPreviewId !== null && (
                  <Box
                    className={`${styles.row} ${previewDraftId === quickActionRanges.draftPreviewId ? styles.rowPreviewDraft : ""}`}
                    onClick={() => {
                      setShowDrafts(true);
                      setPreviewDraftId(quickActionRanges.draftPreviewId);
                      setDiffPage(0);
                    }}
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="medium">Most recent draft changes</Text>
                      <Text size="small" color="text-low">
                        <OverflowText
                          maxWidth={160}
                          title={revisionLabelText(
                            revisionById.get(quickActionRanges.draftPreviewId)
                              ?.version ?? 0,
                            revisionById.get(quickActionRanges.draftPreviewId)
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            version={
                              revisionById.get(quickActionRanges.draftPreviewId)
                                ?.version ?? 0
                            }
                            title={
                              revisionById.get(quickActionRanges.draftPreviewId)
                                ?.title
                            }
                            numbered={false}
                          />
                        </OverflowText>{" "}
                        <PiArrowsLeftRightBold /> live (
                        <OverflowText
                          maxWidth={160}
                          title={revisionLabelText(
                            liveRevisionId
                              ? (revisionById.get(liveRevisionId)?.version ?? 0)
                              : 0,
                            liveRevisionId
                              ? revisionById.get(liveRevisionId)?.title
                              : null,
                          )}
                        >
                          <RevisionLabel
                            version={
                              liveRevisionId
                                ? (revisionById.get(liveRevisionId)?.version ??
                                  0)
                                : 0
                            }
                            title={
                              liveRevisionId
                                ? revisionById.get(liveRevisionId)?.title
                                : null
                            }
                            numbered={false}
                          />
                        </OverflowText>
                        )
                      </Text>
                    </Flex>
                  </Box>
                )}
                {quickActionRanges.liveRange && (
                  <Box
                    className={`${styles.row} ${
                      isRangeEqual(
                        selectedSorted,
                        quickActionRanges.liveRange,
                      ) &&
                      !showDrafts &&
                      !showDiscarded
                        ? styles.rowSelected
                        : ""
                    }`}
                    onClick={() =>
                      quickActionRanges.liveRange &&
                      applyLiveQuickAction(quickActionRanges.liveRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="medium">Most recent live changes</Text>
                      <Text size="small" color="text-low">
                        <OverflowText
                          maxWidth={80}
                          title={revisionLabelText(
                            revisionById.get(quickActionRanges.liveRange[0])
                              ?.version ?? 0,
                            revisionById.get(quickActionRanges.liveRange[0])
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            version={
                              revisionById.get(quickActionRanges.liveRange[0])
                                ?.version ?? 0
                            }
                            title={
                              revisionById.get(quickActionRanges.liveRange[0])
                                ?.title
                            }
                            numbered={false}
                          />
                        </OverflowText>{" "}
                        <PiArrowsLeftRightBold />{" "}
                        <OverflowText
                          maxWidth={80}
                          title={revisionLabelText(
                            revisionById.get(quickActionRanges.liveRange[1])
                              ?.version ?? 0,
                            revisionById.get(quickActionRanges.liveRange[1])
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            version={
                              revisionById.get(quickActionRanges.liveRange[1])
                                ?.version ?? 0
                            }
                            title={
                              revisionById.get(quickActionRanges.liveRange[1])
                                ?.title
                            }
                            numbered={false}
                          />
                        </OverflowText>
                      </Text>
                    </Flex>
                  </Box>
                )}
                {quickActionRanges.allRange && (
                  <Box
                    className={`${styles.row} ${
                      isRangeEqual(
                        selectedSorted,
                        quickActionRanges.allRange,
                      ) &&
                      !showDrafts &&
                      !showDiscarded
                        ? styles.rowSelected
                        : ""
                    }`}
                    onClick={() =>
                      quickActionRanges.allRange &&
                      applyLiveQuickAction(quickActionRanges.allRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="medium">All changes</Text>
                      <Text size="small" color="text-low">
                        <OverflowText
                          maxWidth={80}
                          title={revisionLabelText(
                            revisionById.get(quickActionRanges.allRange[0])
                              ?.version ?? 0,
                            revisionById.get(quickActionRanges.allRange[0])
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            version={
                              revisionById.get(quickActionRanges.allRange[0])
                                ?.version ?? 0
                            }
                            title={
                              revisionById.get(quickActionRanges.allRange[0])
                                ?.title
                            }
                            numbered={false}
                          />
                        </OverflowText>{" "}
                        <PiArrowsLeftRightBold />{" "}
                        <OverflowText
                          maxWidth={80}
                          title={revisionLabelText(
                            revisionById.get(quickActionRanges.allRange[1])
                              ?.version ?? 0,
                            revisionById.get(quickActionRanges.allRange[1])
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            version={
                              revisionById.get(quickActionRanges.allRange[1])
                                ?.version ?? 0
                            }
                            title={
                              revisionById.get(quickActionRanges.allRange[1])
                                ?.title
                            }
                            numbered={false}
                          />
                        </OverflowText>
                      </Text>
                    </Flex>
                  </Box>
                )}
              </Flex>
            </Box>
          )}
          <Box className={styles.section} pb="3">
            <Flex align="center" justify="between" mb="2">
              <Text size="medium" weight="medium" color="text-mid">
                Select range of revisions
              </Text>
              {(hasDraftRevisions ||
                hasDiscardedRevisions ||
                hasMergedRevisions) &&
                (() => {
                  const opts = [
                    ...(hasMergedRevisions
                      ? [
                          {
                            label: "Show locked",
                            hidden: !showMerged,
                            toggle: () => setShowMerged((v) => !v),
                          },
                        ]
                      : []),
                    ...(hasDraftRevisions
                      ? [
                          {
                            label: "Show drafts",
                            hidden: !showDrafts,
                            toggle: () => setShowDrafts((v) => !v),
                          },
                        ]
                      : []),
                    ...(hasDiscardedRevisions
                      ? [
                          {
                            label: "Show discarded",
                            hidden: !showDiscarded,
                            toggle: () => setShowDiscarded((v) => !v),
                          },
                        ]
                      : []),
                  ];
                  const count = opts.filter((o) => o.hidden).length;
                  const isShowingAll = count === 0;
                  const isAtDefault =
                    (!hasMergedRevisions || showMerged) &&
                    (!hasDraftRevisions || showDrafts) &&
                    (!hasDiscardedRevisions || !showDiscarded);
                  return (
                    <DropdownMenu
                      modal={true}
                      trigger={
                        <Link>
                          Filters
                          {count > 0 && (
                            <Badge
                              color="indigo"
                              variant="solid"
                              radius="full"
                              label={String(count)}
                              style={{ minWidth: 18, height: 18, marginTop: 1 }}
                              ml="1"
                            />
                          )}
                        </Link>
                      }
                      menuPlacement="end"
                      variant="soft"
                    >
                      {!isShowingAll && (
                        <DropdownMenuItem
                          onClick={() => {
                            if (hasMergedRevisions) setShowMerged(true);
                            if (hasDraftRevisions) setShowDrafts(true);
                            if (hasDiscardedRevisions) setShowDiscarded(true);
                          }}
                        >
                          <Flex align="center">
                            <span style={{ width: 24, display: "inline-flex" }}>
                              <PiX size={16} />
                            </span>
                            Remove all filters
                          </Flex>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        disabled={isAtDefault}
                        onClick={() => {
                          setShowMerged(true);
                          setShowDrafts(true);
                          setShowDiscarded(false);
                        }}
                      >
                        <Flex align="center">
                          <span style={{ width: 24, display: "inline-flex" }}>
                            <PiClockClockwise size={16} />
                          </span>
                          {isAtDefault
                            ? "Using default filters"
                            : "Use default filters"}
                        </Flex>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {opts.map((opt) => (
                        <DropdownMenuItem
                          key={opt.label}
                          onClick={() => opt.toggle()}
                        >
                          <Flex align="center">
                            <span
                              style={{
                                width: 24,
                                display: "inline-flex",
                                pointerEvents: "none",
                              }}
                            >
                              <Checkbox
                                value={!opt.hidden}
                                setValue={() => {}}
                              />
                            </span>
                            {opt.label}
                          </Flex>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenu>
                  );
                })()}
            </Flex>
            <Flex direction="column" className={styles.revisionsList}>
              {sidebarRevisionsDesc.map((id) => {
                const minRev = revisionById.get(id);
                const isSelected = selectedSortedSet.has(id);
                const isPreviewDraft = id === previewDraftId;
                const checkboxChecked =
                  previewDraftId !== null
                    ? id === previewDraftId || id === liveRevisionId
                    : isSelected;
                const isDraftRevision =
                  !!minRev && ACTIVE_DRAFT_STATUSES.includes(minRev.status);
                const rowId = `compare-rev-${id}`;
                const isExpanded = expandedRevisionIds.has(id);
                const timeline = activityTimelinesById.get(id) ?? [];
                return (
                  <Box key={id} className={styles.rowWrapper}>
                    <label
                      htmlFor={rowId}
                      className={`${styles.row} ${
                        isPreviewDraft
                          ? styles.rowPreviewDraft
                          : previewDraftId === null && isSelected
                            ? styles.rowSelected
                            : ""
                      }`}
                      onClick={() => setActiveActivity(null)}
                    >
                      <span style={{ pointerEvents: "none" }}>
                        <Checkbox
                          id={rowId}
                          value={checkboxChecked}
                          setValue={() => toggleRevision(id)}
                        />
                      </span>
                      <Flex
                        direction="column"
                        gap="1"
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <Flex
                          align="center"
                          justify="between"
                          gap="2"
                          width="100%"
                        >
                          <Flex
                            align="center"
                            gap="1"
                            style={{ minWidth: 0, flex: 1, overflow: "hidden" }}
                          >
                            <div
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                minWidth: 0,
                                fontWeight: "bold",
                              }}
                              title={revisionLabelText(
                                minRev?.version ?? 0,
                                minRev?.title,
                              )}
                            >
                              <RevisionLabel
                                version={minRev?.version ?? 0}
                                title={minRev?.title}
                              />
                            </div>
                          </Flex>
                          {minRev ? (
                            <Box flexShrink="0">
                              <RevisionStatusBadge
                                revision={minRev}
                                liveRevisionId={liveRevisionId}
                                requiresApproval={requiresApproval}
                              />
                            </Box>
                          ) : null}
                        </Flex>
                        {minRev ? (
                          <Text size="small" color="text-low">
                            {datetime(minRev.dateUpdated)}
                            {minRev.authorId
                              ? ` · ${getUserDisplay(minRev.authorId) || minRev.authorId}`
                              : ""}
                          </Text>
                        ) : null}
                      </Flex>
                      {isDraftRevision && previewDraftId !== id && (
                        <div className={styles.previewButtonWrapper}>
                          <Button
                            variant="outline"
                            size="xs"
                            className={styles.previewButton}
                            onClick={(e?) => {
                              e?.stopPropagation();
                              e?.preventDefault();
                              setPreviewDraftId(id);
                              setDiffPage(0);
                            }}
                          >
                            Compare with live
                          </Button>
                        </div>
                      )}
                      <div className={styles.rowCaret}>
                        <Tooltip
                          body={
                            isExpanded
                              ? "Collapse audit history"
                              : "Expand audit history"
                          }
                        >
                          <button
                            type="button"
                            className={styles.expandChevron}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setExpandedRevisionIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(id)) {
                                  next.delete(id);
                                  if (activeActivity?.revisionId === id) {
                                    setActiveActivity(null);
                                  }
                                } else {
                                  next.add(id);
                                }
                                return next;
                              });
                            }}
                          >
                            {isExpanded ? (
                              <PiCaretDownBold size={12} />
                            ) : (
                              <PiCaretRightBold size={12} />
                            )}
                          </button>
                        </Tooltip>
                      </div>
                    </label>
                    {isExpanded && (
                      <div className={styles.logSubRows}>
                        {timeline.length === 0 ? (
                          <Text size="small" color="text-low" ml="2">
                            No activity recorded
                          </Text>
                        ) : (
                          timeline.map((item) => {
                            const isActive =
                              activeActivity?.revisionId === id &&
                              activeActivity.activityId === item.id;
                            return (
                              <div
                                key={item.id}
                                className={`${styles.logSubRow} ${
                                  isActive ? styles.logSubRowActive : ""
                                }`}
                                onClick={() =>
                                  setActiveActivity(
                                    isActive
                                      ? null
                                      : { revisionId: id, activityId: item.id },
                                  )
                                }
                              >
                                <Flex
                                  direction="column"
                                  gap="1"
                                  style={{ minWidth: 0, flex: 1 }}
                                >
                                  <div
                                    style={{
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      fontWeight: isActive ? "bold" : 500,
                                    }}
                                  >
                                    {activityLabel(item)}
                                  </div>
                                  <Text size="small" color="text-low">
                                    {datetime(item.createdAt)}
                                    {item.userId
                                      ? ` · ${
                                          getUserDisplay(item.userId) ||
                                          item.userId
                                        }`
                                      : ""}
                                  </Text>
                                </Flex>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </Box>
                );
              })}
            </Flex>
          </Box>
        </Box>
        <Box
          flexGrow="1"
          position="relative"
          className={`${styles.sidebar} overflow-auto`}
          style={{ minHeight: 0 }}
        >
          {activeActivity !== null &&
          (() => {
            const timeline = activityTimelinesById.get(
              activeActivity.revisionId,
            );
            return timeline?.some((i) => i.id === activeActivity.activityId);
          })() ? (
            // Audit history drill-down panel
            (() => {
              const timeline =
                activityTimelinesById.get(activeActivity.revisionId) ?? [];
              const item = timeline.find(
                (i) => i.id === activeActivity.activityId,
              );
              const rev = revisionById.get(activeActivity.revisionId);
              if (!item) return null;
              const userDisplay = getUserDisplay(item.userId) || item.userId;
              return (
                <>
                  <Box
                    pb="3"
                    mb="3"
                    style={{ borderBottom: "1px solid var(--gray-5)" }}
                  >
                    <Flex align="center" gap="2" wrap="wrap">
                      <Tooltip body="Return to revision">
                        <button
                          type="button"
                          className={styles.backButton}
                          onClick={() => setActiveActivity(null)}
                        >
                          <PiCaretLeftBold size={16} />
                        </button>
                      </Tooltip>
                      <Heading as="h2" size="small" mb="0">
                        Log entry
                      </Heading>
                      {rev ? (
                        <Text size="small" color="text-low">
                          · {revisionLabelText(rev.version ?? 0, rev.title)}
                        </Text>
                      ) : null}
                    </Flex>
                  </Box>
                  <LogEntryPanel
                    item={item}
                    userDisplay={userDisplay}
                    diff={logEntryDiffSnapshots ? logEntryDiff : null}
                    diffMode={logEntryDiffMode}
                  />
                </>
              );
            })()
          ) : previewDraftId !== null ? (
            // Preview draft mode
            <>
              <Box
                pb="3"
                mb="3"
                style={{ borderBottom: "1px solid var(--gray-5)" }}
              >
                <Flex align="center" justify="between" gap="4" wrap="wrap">
                  <Flex align="center" gap="2">
                    <Heading as="h2" size="small" mb="0">
                      Preview draft
                    </Heading>
                    <Text size="small" color="text-low">
                      Draft content vs live (two-way)
                    </Text>
                  </Flex>
                </Flex>
                <RevisionCompareLabel
                  revA={previewLiveRev}
                  revB={previewDraftRev}
                  liveRevisionId={liveRevisionId}
                  requiresApproval={requiresApproval}
                  mt="3"
                />
              </Box>
              {previewDraftRev && (
                <RevisionDiff
                  diffs={previewDraftDiff.diffs}
                  badges={previewDraftDiff.badges}
                  customRenderGroups={previewDraftDiff.customRenderGroups}
                />
              )}
            </>
          ) : steps.length === 0 ? (
            <Text color="text-low">
              Select at least two revisions in the list to see the diff.
            </Text>
          ) : (
            // Standard range comparison mode
            <>
              <Box
                pb="3"
                mb="3"
                style={{ borderBottom: "1px solid var(--gray-5)" }}
              >
                <Flex align="center" justify="between" gap="4" wrap="wrap">
                  <Flex align="center" gap="4">
                    {diffViewMode === "steps" && (
                      <>
                        <Heading as="h2" size="small" mb="0">
                          Step {safeDiffPage + 1} of {steps.length}
                        </Heading>
                        <Flex gap="2">
                          <Button
                            variant="soft"
                            size="sm"
                            disabled={safeDiffPage <= 0}
                            onClick={() =>
                              setDiffPage((p) => Math.max(0, p - 1))
                            }
                          >
                            Previous
                          </Button>
                          <Button
                            variant="soft"
                            size="sm"
                            disabled={safeDiffPage >= steps.length - 1}
                            onClick={() =>
                              setDiffPage((p) =>
                                Math.min(steps.length - 1, p + 1),
                              )
                            }
                          >
                            Next
                          </Button>
                        </Flex>
                      </>
                    )}
                    {diffViewMode === "single" &&
                      selectedSorted.length >= 2 && (
                        <RevisionCompareLabel
                          revA={singleRevFirst}
                          revB={singleRevLast}
                          liveRevisionId={liveRevisionId}
                          requiresApproval={requiresApproval}
                        />
                      )}
                  </Flex>
                  <Flex align="center" gap="2">
                    <Text size="medium" weight="medium" color="text-mid">
                      Show diff as
                    </Text>
                    <Select
                      value={diffViewMode}
                      setValue={(v) => setDiffViewModeRaw(v)}
                      size="small"
                      mb="0"
                    >
                      <SelectItem value="steps">Steps</SelectItem>
                      <SelectItem value="single">Single diff</SelectItem>
                    </Select>
                  </Flex>
                </Flex>
                {diffViewMode === "steps" && currentStep && (
                  <RevisionCompareLabel
                    revA={stepRevA}
                    revB={stepRevB}
                    liveRevisionId={liveRevisionId}
                    requiresApproval={requiresApproval}
                    mt="3"
                  />
                )}
              </Box>
              {diffViewMode === "steps" && currentStep && stepRevB ? (
                <RevisionDiff
                  diffs={stepDiff.diffs}
                  badges={stepDiff.badges}
                  customRenderGroups={stepDiff.customRenderGroups}
                />
              ) : diffViewMode === "single" && singleRevLast ? (
                <RevisionDiff
                  diffs={singleDiff.diffs}
                  badges={singleDiff.badges}
                  customRenderGroups={singleDiff.customRenderGroups}
                />
              ) : (
                <Text color="text-low">No diff available.</Text>
              )}
            </>
          )}
        </Box>
      </Flex>
    </Modal>
  );
}
