import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
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
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Badge from "@/ui/Badge";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { RevisionDiff } from "@/components/Revision/RevisionDiff";
import { useRevisionDiff } from "@/components/Revision/useRevisionDiff";
import { REVISION_SAVED_GROUP_DIFF_CONFIG } from "@/components/Revision/RevisionDiffConfig";
import styles from "./CompareSavedGroupRevisionsModal.module.scss";

const STORAGE_KEY_PREFIX = "saved-group:compare-revisions";

const ACTIVE_DRAFT_STATUSES = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
];

export interface Props {
  savedGroup: SavedGroupInterface;
  allRevisions: Revision[];
  currentRevisionId: string | null;
  onClose: () => void;
  mutate: () => void;
  // Opens directly in "preview draft vs live" mode for this revision
  initialPreviewDraft?: string;
  initialMode?: "most-recent-live";
  requiresApproval?: boolean;
}

function RevisionLabel({ title }: { title?: string | null }) {
  return <span>{title || "Untitled"}</span>;
}

function revisionLabelText(title?: string | null): string {
  return title || "Untitled";
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

  // Show live badge if this is the live revision
  if (revision.id === liveRevisionId) {
    return <Badge color="teal" variant="soft" label="Live" />;
  }

  // Otherwise show the actual revision status
  switch (revision.status) {
    case "draft":
      return <Badge color="indigo" variant="soft" label="Draft" />;
    case "pending-review":
      // Show as "Draft" if approvals are not required
      return requiresApproval ? (
        <Badge color="yellow" variant="soft" label="Pending Review" />
      ) : (
        <Badge color="indigo" variant="soft" label="Draft" />
      );
    case "approved":
      return <Badge color="blue" variant="soft" label="Approved" />;
    case "changes-requested":
      return <Badge color="orange" variant="soft" label="Changes Requested" />;
    case "merged":
      return <Badge color="gray" variant="soft" label="Merged" />;
    case "closed":
      return <Badge color="gray" variant="soft" label="Closed" />;
    default:
      return null;
  }
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
                title={revisionLabelText(revA?.title)}
              >
                <RevisionLabel title={revA?.title} />
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
                title={revisionLabelText(revB?.title)}
              >
                <RevisionLabel title={revB?.title} />
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

export default function CompareSavedGroupRevisionsModal({
  savedGroup,
  allRevisions,
  currentRevisionId,
  onClose,
  initialPreviewDraft,
  initialMode,
  requiresApproval = true,
}: Props) {
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
    `${STORAGE_KEY_PREFIX}:${savedGroup.id}:showDiscarded`,
    false,
  );
  const [showDrafts, setShowDrafts] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:${savedGroup.id}:showDrafts`,
    true,
  );
  const [diffViewModeRaw, setDiffViewModeRaw] = useLocalStorage<string>(
    `${STORAGE_KEY_PREFIX}:${savedGroup.id}:diffViewMode`,
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
        // Filter out all merged revisions since they're part of live history
        if (r.status === "merged") return false;
        if (r.status === "closed" && !showDiscarded) return false;
        if (ACTIVE_DRAFT_STATUSES.includes(r.status) && !showDrafts)
          return false;
        return true;
      })
      .reverse(); // Show newest first
  }, [sortedRevisionsAsc, showDiscarded, showDrafts]);

  const revisionsDesc = useMemo(() => {
    return filteredRevisionList.map((r) => r.id);
  }, [filteredRevisionList]);

  // Compute default comparison target
  const defaultAdjacentId = useMemo(() => {
    const allDesc = [...sortedRevisionsAsc]
      .filter((r) => r.status !== "closed")
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [previewDraftId, setPreviewDraftId] = useState<string | null>(
    initialPreviewDraft ?? null,
  );

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
      // Ensure the range is in chronological order
      setSelectedRevisionIds(sortByChronological(range));
      setDiffPage(0);
    },
    [setShowDrafts, setShowDiscarded, sortByChronological],
  );

  const toggleRevision = (id: string) => {
    setPreviewDraftId(null);
    setSelectedRevisionIds((prev) => {
      const idx = revisionsDesc.indexOf(id);
      if (idx === -1) return prev;

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
    () => allRevisions.some((r) => r.status === "closed"),
    [allRevisions],
  );
  const hasDraftRevisions = useMemo(
    () => allRevisions.some((r) => ACTIVE_DRAFT_STATUSES.includes(r.status)),
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
        ? (previewDraftRev.target.snapshot as SavedGroupInterface)
        : savedGroup;
    const proposedSnapshot = {
      ...baseSnapshot,
      ...(previewDraftRev.target
        .proposedChanges as Partial<SavedGroupInterface>),
    } as SavedGroupInterface;
    return { baseSnapshot, proposedSnapshot };
  }, [previewDraftRev, savedGroup]);

  const stepDiffSnapshots = useMemo(() => {
    if (!stepRevB) return null;
    const baseState = stepRevA
      ? (stepRevA.target.snapshot as SavedGroupInterface)
      : savedGroup;
    const baseSnapshot =
      stepRevB.status === "merged"
        ? (stepRevB.target.snapshot as SavedGroupInterface)
        : baseState;
    const proposedSnapshot = {
      ...baseSnapshot,
      ...(stepRevB.target.proposedChanges as Partial<SavedGroupInterface>),
    } as SavedGroupInterface;
    return { baseSnapshot, proposedSnapshot };
  }, [stepRevA, stepRevB, savedGroup]);

  const singleDiffSnapshots = useMemo(() => {
    if (!singleRevLast) return null;
    const baseState = singleRevFirst
      ? (singleRevFirst.target.snapshot as SavedGroupInterface)
      : savedGroup;
    const baseSnapshot =
      singleRevLast.status === "merged"
        ? (singleRevLast.target.snapshot as SavedGroupInterface)
        : baseState;
    const proposedSnapshot = {
      ...baseSnapshot,
      ...(singleRevLast.target.proposedChanges as Partial<SavedGroupInterface>),
    } as SavedGroupInterface;
    return { baseSnapshot, proposedSnapshot };
  }, [singleRevFirst, singleRevLast, savedGroup]);

  // Call useRevisionDiff hooks at the top level for all scenarios
  const previewDraftDiff = useRevisionDiff<SavedGroupInterface>(
    previewDraftSnapshots?.baseSnapshot || savedGroup,
    previewDraftSnapshots?.proposedSnapshot || savedGroup,
    REVISION_SAVED_GROUP_DIFF_CONFIG,
  );

  const stepDiff = useRevisionDiff<SavedGroupInterface>(
    stepDiffSnapshots?.baseSnapshot || savedGroup,
    stepDiffSnapshots?.proposedSnapshot || savedGroup,
    REVISION_SAVED_GROUP_DIFF_CONFIG,
  );

  const singleDiff = useRevisionDiff<SavedGroupInterface>(
    singleDiffSnapshots?.baseSnapshot || savedGroup,
    singleDiffSnapshots?.proposedSnapshot || savedGroup,
    REVISION_SAVED_GROUP_DIFF_CONFIG,
  );

  return (
    <Modal
      trackingEventModalType="compare-saved-group-revisions"
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
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            title={
                              revisionById.get(quickActionRanges.draftPreviewId)
                                ?.title
                            }
                          />
                        </OverflowText>{" "}
                        <PiArrowsLeftRightBold /> live (
                        <OverflowText
                          maxWidth={160}
                          title={revisionLabelText(
                            liveRevisionId
                              ? revisionById.get(liveRevisionId)?.title
                              : null,
                          )}
                        >
                          <RevisionLabel
                            title={
                              liveRevisionId
                                ? revisionById.get(liveRevisionId)?.title
                                : null
                            }
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
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            title={
                              revisionById.get(quickActionRanges.liveRange[0])
                                ?.title
                            }
                          />
                        </OverflowText>{" "}
                        <PiArrowsLeftRightBold />{" "}
                        <OverflowText
                          maxWidth={80}
                          title={revisionLabelText(
                            revisionById.get(quickActionRanges.liveRange[1])
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            title={
                              revisionById.get(quickActionRanges.liveRange[1])
                                ?.title
                            }
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
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            title={
                              revisionById.get(quickActionRanges.allRange[0])
                                ?.title
                            }
                          />
                        </OverflowText>{" "}
                        <PiArrowsLeftRightBold />{" "}
                        <OverflowText
                          maxWidth={80}
                          title={revisionLabelText(
                            revisionById.get(quickActionRanges.allRange[1])
                              ?.title,
                          )}
                        >
                          <RevisionLabel
                            title={
                              revisionById.get(quickActionRanges.allRange[1])
                                ?.title
                            }
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
              {(hasDraftRevisions || hasDiscardedRevisions) &&
                (() => {
                  const opts = [
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
                              title={revisionLabelText(minRev?.title)}
                            >
                              <RevisionLabel title={minRev?.title} />
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
                    </label>
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
          {previewDraftId !== null ? (
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
                      size="2"
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
