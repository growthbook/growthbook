import React, { useCallback, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Revision, applyTopLevelPatchOps } from "shared/enterprise";
import { SDKConnectionRevisionSnapshot } from "shared/validators";
import { PiClockClockwise } from "react-icons/pi";
import { datetime } from "shared/dates";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Checkbox from "@/ui/Checkbox";
import { Select, SelectItem } from "@/ui/Select";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { RevisionDiff } from "@/components/Revision/RevisionDiff";
import { useRevisionDiff } from "@/components/Revision/useRevisionDiff";
import { REVISION_SDK_CONNECTION_DIFF_CONFIG } from "@/components/Features/SDKConnections/SDKConnectionDiffRenders";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import { useUser } from "@/services/UserContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import styles from "@/components/SavedGroups/CompareSavedGroupRevisionsModal.module.scss";

const STORAGE_KEY_PREFIX = "sdk-connection:compare-revisions";

const ACTIVE_DRAFT_STATUSES = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
];

interface Props {
  allRevisions: Revision[];
  onClose: () => void;
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

export default function CompareSDKConnectionRevisionsModal({
  allRevisions,
  onClose,
  requiresApproval = true,
}: Props) {
  const { getUserDisplay } = useUser();

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

  // Sort by creation date for display
  const sortedRevisionsAsc = useMemo(() => {
    return [...allRevisions].sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );
  }, [allRevisions]);

  const revisionById = useMemo(
    () => new Map(allRevisions.map((r) => [r.id, r])),
    [allRevisions],
  );

  // Filter UI state
  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showDiscarded`,
    false,
  );
  const [showDrafts, setShowDrafts] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showDrafts`,
    true,
  );
  const [showMerged, setShowMerged] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showMerged`,
    true,
  );
  const [diffViewModeRaw, setDiffViewModeRaw] = useLocalStorage<string>(
    `${STORAGE_KEY_PREFIX}:diffViewMode`,
    "steps",
  );
  const diffViewMode = diffViewModeRaw === "single" ? "single" : "steps";

  // Filtered revision list
  const filteredRevisionList = useMemo(() => {
    return sortedRevisionsAsc
      .filter((r) => {
        if (r.status === "merged" && !showMerged) return false;
        if (r.status === "discarded" && !showDiscarded) return false;
        if (ACTIVE_DRAFT_STATUSES.includes(r.status) && !showDrafts)
          return false;
        return true;
      })
      .reverse();
  }, [sortedRevisionsAsc, showDiscarded, showDrafts, showMerged]);

  const revisionsDesc = useMemo(
    () => filteredRevisionList.map((r) => r.id),
    [filteredRevisionList],
  );

  // Selected revisions
  const [selectedRevisionIds, setSelectedRevisionIds] = useState<string[]>(
    () => {
      const sortIds = (ids: string[]) => {
        return [...ids].sort((a, b) => {
          const aIdx = sortedRevisionsAsc.findIndex((r) => r.id === a);
          const bIdx = sortedRevisionsAsc.findIndex((r) => r.id === b);
          return aIdx - bIdx;
        });
      };
      if (sortedRevisionsAsc.length < 2) return [];
      return sortIds([
        sortedRevisionsAsc[sortedRevisionsAsc.length - 2].id,
        sortedRevisionsAsc[sortedRevisionsAsc.length - 1].id,
      ]);
    },
  );

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

  const toggleRevision = (id: string) => {
    setSelectedRevisionIds((prev) => {
      const idx = revisionsDesc.indexOf(id);
      if (idx === -1) return prev;

      const prevIndices = prev
        .map((v) => revisionsDesc.indexOf(v))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);

      const startIdx = prevIndices[0] ?? -1;
      const endIdx = prevIndices[prevIndices.length - 1] ?? -1;

      if (prev.includes(id)) {
        if (startIdx === -1 || endIdx === -1 || endIdx - startIdx <= 1)
          return prev;
        const visibleIds = new Set(filteredRevisionList.map((r) => r.id));
        if (idx === startIdx) {
          let newStart = startIdx + 1;
          while (newStart < endIdx && !visibleIds.has(revisionsDesc[newStart]))
            newStart++;
          if (newStart >= endIdx) return prev;
          return sortByChronological([
            revisionsDesc[newStart],
            revisionsDesc[endIdx],
          ]);
        }
        if (idx === endIdx) {
          let newEnd = endIdx - 1;
          while (newEnd > startIdx && !visibleIds.has(revisionsDesc[newEnd]))
            newEnd--;
          if (newEnd <= startIdx) return prev;
          return sortByChronological([
            revisionsDesc[startIdx],
            revisionsDesc[newEnd],
          ]);
        }
        return prev;
      }

      if (prevIndices.length > 0) {
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
      }

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
      return sortByChronological([newLow, newHigh]);
    });
  };

  const steps = useMemo(() => {
    const pairs: [string, string][] = [];
    for (let i = 0; i < selectedSorted.length - 1; i++) {
      pairs.push([selectedSorted[i], selectedSorted[i + 1]]);
    }
    return pairs.reverse();
  }, [selectedSorted]);

  const [diffPage, setDiffPage] = useState(0);
  const safeDiffPage = Math.min(
    Math.max(0, diffPage),
    steps.length > 0 ? steps.length - 1 : 0,
  );

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

  // Compute snapshots
  const stepDiffSnapshots = useMemo(() => {
    if (!stepRevB) return null;
    const baseState = stepRevA
      ? (stepRevA.target.snapshot as SDKConnectionRevisionSnapshot)
      : ({} as SDKConnectionRevisionSnapshot);
    const baseSnapshot =
      stepRevB.status === "merged"
        ? (stepRevB.target.snapshot as SDKConnectionRevisionSnapshot)
        : baseState;
    const proposedSnapshot = applyTopLevelPatchOps(
      baseSnapshot as Record<string, unknown>,
      stepRevB.target.proposedChanges,
    ) as SDKConnectionRevisionSnapshot;
    return { baseSnapshot, proposedSnapshot };
  }, [stepRevA, stepRevB]);

  const singleDiffSnapshots = useMemo(() => {
    if (!singleRevLast) return null;
    const baseState = singleRevFirst
      ? (singleRevFirst.target.snapshot as SDKConnectionRevisionSnapshot)
      : ({} as SDKConnectionRevisionSnapshot);
    const baseSnapshot =
      singleRevLast.status === "merged"
        ? (singleRevLast.target.snapshot as SDKConnectionRevisionSnapshot)
        : baseState;
    const proposedSnapshot = applyTopLevelPatchOps(
      baseSnapshot as Record<string, unknown>,
      singleRevLast.target.proposedChanges,
    ) as SDKConnectionRevisionSnapshot;
    return { baseSnapshot, proposedSnapshot };
  }, [singleRevFirst, singleRevLast]);

  const stepDiff = useRevisionDiff<SDKConnectionRevisionSnapshot>(
    stepDiffSnapshots?.baseSnapshot || ({} as SDKConnectionRevisionSnapshot),
    stepDiffSnapshots?.proposedSnapshot ||
      ({} as SDKConnectionRevisionSnapshot),
    REVISION_SDK_CONNECTION_DIFF_CONFIG,
  );

  const singleDiff = useRevisionDiff<SDKConnectionRevisionSnapshot>(
    singleDiffSnapshots?.baseSnapshot || ({} as SDKConnectionRevisionSnapshot),
    singleDiffSnapshots?.proposedSnapshot ||
      ({} as SDKConnectionRevisionSnapshot),
    REVISION_SDK_CONNECTION_DIFF_CONFIG,
  );

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

  return (
    <Modal
      trackingEventModalType="compare-sdk-connection-revisions"
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
        {/* Sidebar */}
        <Box
          style={{ width: 300, minWidth: 300, minHeight: 0 }}
          className={`${styles.sidebar} ${styles.sidebarLeft} overflow-auto`}
        >
          <Box className={`${styles.section}`} pb="3">
            <Flex align="center" justify="between" mb="2">
              <Text size="medium" weight="medium" color="text-mid">
                Select range of revisions
              </Text>
              {(hasDraftRevisions ||
                hasDiscardedRevisions ||
                hasMergedRevisions) && (
                <DropdownMenu
                  modal={true}
                  trigger={
                    <Link>
                      Filters
                      {[
                        !showMerged && hasMergedRevisions,
                        !showDrafts && hasDraftRevisions,
                        showDiscarded && hasDiscardedRevisions,
                      ].filter(Boolean).length > 0 && (
                        <Badge
                          color="indigo"
                          variant="solid"
                          radius="full"
                          label={String(
                            [
                              !showMerged && hasMergedRevisions,
                              !showDrafts && hasDraftRevisions,
                              showDiscarded && hasDiscardedRevisions,
                            ].filter(Boolean).length,
                          )}
                          style={{ minWidth: 18, height: 18, marginTop: 1 }}
                          ml="1"
                        />
                      )}
                    </Link>
                  }
                  menuPlacement="end"
                  variant="soft"
                >
                  <DropdownMenuItem
                    onClick={() => {
                      if (hasMergedRevisions) setShowMerged(true);
                      if (hasDraftRevisions) setShowDrafts(true);
                      if (hasDiscardedRevisions) setShowDiscarded(false);
                    }}
                  >
                    <Flex align="center">
                      <span style={{ width: 24, display: "inline-flex" }}>
                        <PiClockClockwise size={16} />
                      </span>
                      Use default filters
                    </Flex>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {hasMergedRevisions && (
                    <DropdownMenuItem
                      onClick={() => setShowMerged(!showMerged)}
                    >
                      <Flex align="center">
                        <span
                          style={{
                            width: 24,
                            display: "inline-flex",
                            pointerEvents: "none",
                          }}
                        >
                          <Checkbox value={showMerged} setValue={() => {}} />
                        </span>
                        Show locked
                      </Flex>
                    </DropdownMenuItem>
                  )}
                  {hasDraftRevisions && (
                    <DropdownMenuItem
                      onClick={() => setShowDrafts(!showDrafts)}
                    >
                      <Flex align="center">
                        <span
                          style={{
                            width: 24,
                            display: "inline-flex",
                            pointerEvents: "none",
                          }}
                        >
                          <Checkbox value={showDrafts} setValue={() => {}} />
                        </span>
                        Show drafts
                      </Flex>
                    </DropdownMenuItem>
                  )}
                  {hasDiscardedRevisions && (
                    <DropdownMenuItem
                      onClick={() => setShowDiscarded(!showDiscarded)}
                    >
                      <Flex align="center">
                        <span
                          style={{
                            width: 24,
                            display: "inline-flex",
                            pointerEvents: "none",
                          }}
                        >
                          <Checkbox value={showDiscarded} setValue={() => {}} />
                        </span>
                        Show discarded
                      </Flex>
                    </DropdownMenuItem>
                  )}
                </DropdownMenu>
              )}
            </Flex>
            <Flex direction="column" className={styles.revisionsList}>
              {filteredRevisionList.map((rev) => {
                const isSelected = selectedSortedSet.has(rev.id);
                const rowId = `compare-rev-${rev.id}`;
                return (
                  <Box key={rev.id} className={styles.rowWrapper}>
                    <label
                      htmlFor={rowId}
                      className={`${styles.row} ${
                        isSelected ? styles.rowSelected : ""
                      }`}
                    >
                      <span style={{ pointerEvents: "none" }}>
                        <Checkbox
                          id={rowId}
                          value={isSelected}
                          setValue={() => toggleRevision(rev.id)}
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
                            style={{
                              minWidth: 0,
                              flex: 1,
                              overflow: "hidden",
                              fontWeight: "bold",
                            }}
                          >
                            {`Revision ${rev.version || "?"}`}
                            {rev.title && ` — ${rev.title}`}
                          </Flex>
                          <Box flexShrink="0">
                            <RevisionStatusBadge
                              revision={rev}
                              liveRevisionId={liveRevisionId}
                              requiresApproval={requiresApproval}
                            />
                          </Box>
                        </Flex>
                        <Text size="small" color="text-low">
                          {datetime(rev.dateUpdated)}
                          {rev.authorId
                            ? ` · ${
                                getUserDisplay(rev.authorId) || rev.authorId
                              }`
                            : ""}
                        </Text>
                      </Flex>
                    </label>
                  </Box>
                );
              })}
            </Flex>
          </Box>
        </Box>

        {/* Main view */}
        <Box
          flexGrow="1"
          position="relative"
          className={`${styles.sidebar} overflow-auto`}
          style={{ minHeight: 0 }}
        >
          {steps.length === 0 ? (
            <Box p="4">
              <Text color="text-low">
                Select at least two revisions in the list to see the diff.
              </Text>
            </Box>
          ) : (
            <>
              <Box
                pb="3"
                mb="3"
                p="4"
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
              </Box>
              <Box p="4">
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
              </Box>
            </>
          )}
        </Box>
      </Flex>
    </Modal>
  );
}
