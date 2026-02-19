import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Box, Flex } from "@radix-ui/themes";
import {
  PiArrowsLeftRightBold,
  PiClockClockwise,
  PiWarningBold,
  PiX,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import { DRAFT_REVISION_STATUSES } from "shared/util";
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
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Badge from "@/ui/Badge";
import LoadingOverlay from "@/components/LoadingOverlay";
import EventUser from "@/components/Avatar/EventUser";
import {
  useFeatureRevisionDiff,
  FeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import { ExpandableDiff } from "./DraftModal";
import RevisionStatusBadge from "./RevisionStatusBadge";
import styles from "./CompareRevisionsModal.module.scss";

const STORAGE_KEY_PREFIX = "feature:compare-revisions";

export interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  currentVersion: number;
  onClose: () => void;
}

function revisionToDiffInput(
  r: FeatureRevisionInterface,
): FeatureRevisionDiffInput {
  return { defaultValue: r.defaultValue, rules: r.rules ?? {} };
}

function RevisionCompareLabel({
  versionA,
  versionB,
  revA,
  revB,
  liveVersion,
  revAFailed = false,
  revBFailed = false,
  mb,
}: {
  versionA: number;
  versionB: number;
  revA: FeatureRevisionInterface | null;
  revB: FeatureRevisionInterface | null;
  liveVersion: number;
  revAFailed?: boolean;
  revBFailed?: boolean;
  mb?: "1" | "2" | "3" | "4";
}) {
  return (
    <Flex align="center" gap="4" wrap="nowrap" mb={mb}>
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
            <Text weight="semibold" size="medium">
              Revision {versionA}
            </Text>
          </Flex>
          <RevisionStatusBadge revision={revA} liveVersion={liveVersion} />
        </Flex>
        {revA &&
          revA.baseVersion !== 0 &&
          (DRAFT_REVISION_STATUSES.includes(revA.status) &&
          revA.baseVersion !== liveVersion ? (
            <HelperText status="warning" size="sm">
              based on: {revA.baseVersion}
            </HelperText>
          ) : (
            <Text as="div" size="small" color="text-low">
              based on: {revA.baseVersion}
            </Text>
          ))}
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
            <Text weight="semibold" size="medium">
              Revision {versionB}
            </Text>
          </Flex>
          <RevisionStatusBadge revision={revB} liveVersion={liveVersion} />
        </Flex>
        {revB &&
          revB.baseVersion !== 0 &&
          (DRAFT_REVISION_STATUSES.includes(revB.status) &&
          revB.baseVersion !== liveVersion ? (
            <HelperText status="warning" size="sm">
              based on: {revB.baseVersion}
            </HelperText>
          ) : (
            <Text as="div" size="small" color="text-low">
              based on: {revB.baseVersion}
            </Text>
          ))}
      </Flex>
    </Flex>
  );
}

export default function CompareRevisionsModal({
  feature,
  revisionList,
  revisions,
  currentVersion,
  onClose,
}: Props) {
  const { apiCall } = useAuth();
  const liveVersion = feature.version;

  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showDiscarded`,
    false,
  );
  const [showDrafts, setShowDrafts] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showDrafts`,
    true,
  );
  const [diffViewModeRaw, setDiffViewModeRaw] = useLocalStorage<string>(
    `${STORAGE_KEY_PREFIX}:diffViewMode`,
    "steps",
  );
  const diffViewMode = diffViewModeRaw === "single" ? "single" : "steps";

  const filteredRevisionList = useMemo(
    () =>
      revisionList.filter((r) => {
        if (r.status === "discarded" && !showDiscarded) return false;
        if (DRAFT_REVISION_STATUSES.includes(r.status) && !showDrafts)
          return false;
        return true;
      }),
    [revisionList, showDiscarded, showDrafts],
  );

  const versionsDesc = useMemo(() => {
    const list = [...filteredRevisionList];
    list.sort((a, b) => b.version - a.version);
    return list.map((r) => r.version);
  }, [filteredRevisionList]);

  const versionsAsc = useMemo(
    () => [...versionsDesc].sort((a, b) => a - b),
    [versionsDesc],
  );

  const defaultAdjacentVersion = useMemo(() => {
    if (versionsDesc.length < 2) return null;
    const idx = versionsDesc.indexOf(currentVersion);
    if (idx < 0) return versionsDesc[1] ?? versionsDesc[0];
    if (idx === versionsDesc.length - 1) {
      return versionsDesc[idx - 1] ?? null;
    }
    return versionsDesc[idx + 1];
  }, [versionsDesc, currentVersion]);

  const [selectedVersions, setSelectedVersions] = useState<number[]>(() => {
    if (!defaultAdjacentVersion) return [currentVersion];
    const pair = [currentVersion, defaultAdjacentVersion].sort((a, b) => a - b);
    return pair;
  });

  const [fetchedRevisions, setFetchedRevisions] = useState<
    Record<number, FeatureRevisionInterface>
  >({});
  const [loadingVersions, setLoadingVersions] = useState<Set<number>>(
    new Set(),
  );
  const [failedVersions, setFailedVersions] = useState<Set<number>>(new Set());
  const fetchingRef = useRef<Set<number>>(new Set());

  const getFullRevision = useCallback(
    (version: number): FeatureRevisionInterface | null => {
      const fromRevisions = revisions.find((r) => r.version === version);
      if (fromRevisions) return fromRevisions;
      return fetchedRevisions[version] ?? null;
    },
    [revisions, fetchedRevisions],
  );

  const fetchRevisions = useCallback(
    async (versions: number[]) => {
      // Filter out already cached or currently in-flight versions
      const toFetch = versions.filter(
        (v) => !getFullRevision(v) && !fetchingRef.current.has(v),
      );
      if (!toFetch.length) return;

      // Clear any previous failures for versions we're about to (re)fetch
      setFailedVersions((prev) => {
        if (!toFetch.some((v) => prev.has(v))) return prev;
        const next = new Set(prev);
        toFetch.forEach((v) => next.delete(v));
        return next;
      });

      toFetch.forEach((v) => fetchingRef.current.add(v));
      setLoadingVersions((prev) => {
        const next = new Set(prev);
        toFetch.forEach((v) => next.add(v));
        return next;
      });

      try {
        const response = await apiCall<{
          revisions: FeatureRevisionInterface[];
        }>(`/feature/${feature.id}/revisions?versions=${toFetch.join(",")}`);
        const returnedVersions = new Set(
          response.revisions?.map((r) => r.version) ?? [],
        );
        if (returnedVersions.size) {
          setFetchedRevisions((prev) => {
            const next = { ...prev };
            response.revisions.forEach((r) => {
              next[r.version] = r;
            });
            return next;
          });
        }
        // Versions that were requested but not returned are definitively missing
        const missing = toFetch.filter((v) => !returnedVersions.has(v));
        if (missing.length) {
          setFailedVersions((prev) => {
            const next = new Set(prev);
            missing.forEach((v) => next.add(v));
            return next;
          });
        }
      } catch {
        // Network / server error — all requested versions failed
        setFailedVersions((prev) => {
          const next = new Set(prev);
          toFetch.forEach((v) => next.add(v));
          return next;
        });
      } finally {
        toFetch.forEach((v) => fetchingRef.current.delete(v));
        setLoadingVersions((prev) => {
          const next = new Set(prev);
          toFetch.forEach((v) => next.delete(v));
          return next;
        });
      }
    },
    [apiCall, feature.id, getFullRevision],
  );

  const selectedSorted = useMemo(() => {
    // selectedVersions holds exactly 2 endpoints [lo, hi]; expand to all
    // visible (non-filtered) versions between them for stepped diffing.
    if (selectedVersions.length < 2) {
      return [...selectedVersions]
        .filter((v) => filteredRevisionList.some((r) => r.version === v))
        .sort((a, b) => a - b);
    }
    const lo = Math.min(...selectedVersions);
    const hi = Math.max(...selectedVersions);
    return filteredRevisionList
      .filter((r) => r.version >= lo && r.version <= hi)
      .map((r) => r.version)
      .sort((a, b) => a - b);
  }, [selectedVersions, filteredRevisionList]);

  // Compare ranges by their endpoints only (both arrays are sorted ascending).
  const isRangeEqual = useCallback(
    (a: number[], b: number[] | null) =>
      !!b &&
      a.length >= 2 &&
      b.length >= 2 &&
      Math.min(...a) === Math.min(...b) &&
      Math.max(...a) === Math.max(...b),
    [],
  );
  const steps = useMemo(() => {
    const pairs: [number, number][] = [];
    for (let i = 0; i < selectedSorted.length - 1; i++) {
      pairs.push([selectedSorted[i], selectedSorted[i + 1]]);
    }
    return pairs.reverse();
  }, [selectedSorted]);

  const selectedSortedSet = useMemo(
    () => new Set(selectedSorted),
    [selectedSorted],
  );

  const neededVersions = selectedSortedSet;

  useEffect(() => {
    const missing = [...neededVersions].filter((v) => !getFullRevision(v));
    if (missing.length) fetchRevisions(missing);
  }, [neededVersions, getFullRevision, fetchRevisions]);

  // A version is failed if the fetch completed but it wasn't returned
  const isVersionFailed = useCallback(
    (v: number) =>
      failedVersions.has(v) && !loadingVersions.has(v) && !getFullRevision(v),
    [failedVersions, loadingVersions, getFullRevision],
  );

  const [diffPage, setDiffPage] = useState(0);
  const canToggleDiffView = selectedSorted.length > 2;
  // Helper: reset endpoints to the two newest visible versions.
  const resetToTopTwo = useCallback(
    (prev: number[]) => {
      const top2 = [...filteredRevisionList]
        .sort((a, b) => b.version - a.version)
        .slice(0, 2)
        .map((r) => r.version)
        .sort((a, b) => a - b);
      return top2.length >= 2 ? top2 : prev;
    },
    [filteredRevisionList],
  );

  const prevShowDiscardedRef = useRef(showDiscarded);
  useEffect(() => {
    if (prevShowDiscardedRef.current === showDiscarded) return;
    prevShowDiscardedRef.current = showDiscarded;
    if (!showDiscarded) {
      // If hiding discarded revision knocks out either endpoint, reset.
      setSelectedVersions((prev) => {
        const visibleSet = new Set(filteredRevisionList.map((r) => r.version));
        if (prev.every((v) => visibleSet.has(v))) return prev;
        return resetToTopTwo(prev);
      });
    }
    // When showing discarded: selectedSorted auto-expands to include them.
  }, [showDiscarded, filteredRevisionList, resetToTopTwo]);

  const prevShowDraftsRef = useRef(showDrafts);
  useEffect(() => {
    if (prevShowDraftsRef.current === showDrafts) return;
    prevShowDraftsRef.current = showDrafts;
    if (!showDrafts) {
      // If hiding drafts knocks out either endpoint, reset.
      setSelectedVersions((prev) => {
        const visibleSet = new Set(filteredRevisionList.map((r) => r.version));
        if (prev.every((v) => visibleSet.has(v))) return prev;
        return resetToTopTwo(prev);
      });
    }
  }, [showDrafts, filteredRevisionList, resetToTopTwo]);
  useEffect(() => {
    setDiffPage((p) =>
      steps.length === 0 ? 0 : Math.min(p, steps.length - 1),
    );
  }, [steps.length]);
  const applyQuickAction = useCallback((range: number[]) => {
    setSelectedVersions(range);
    setDiffPage(0);
  }, []);
  const safeDiffPage = Math.min(
    Math.max(0, diffPage),
    steps.length > 0 ? steps.length - 1 : 0,
  );

  const toggleVersion = (version: number) => {
    setSelectedVersions((prev) => {
      const idx = versionsDesc.indexOf(version);
      if (idx === -1) return prev;

      // Find the current selection range as indices in versionsDesc (newest-first)
      const prevIndices = prev
        .map((v) => versionsDesc.indexOf(v))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);

      const startIdx = prevIndices[0] ?? -1; // newest selected (lowest display index)
      const endIdx = prevIndices[prevIndices.length - 1] ?? -1; // oldest selected

      // Clicking an endpoint shrinks the range to the nearest visible item inward.
      // versionsDesc[startIdx] is the newer (top) endpoint; versionsDesc[endIdx] is the older.
      // Visibility = presence in filteredRevisionList (respects draft/discarded filters).
      if (prev.includes(version)) {
        if (startIdx === -1 || endIdx === -1 || endIdx - startIdx <= 1)
          return prev;
        const visibleVersions = new Set(
          filteredRevisionList.map((r) => r.version),
        );
        if (idx === startIdx) {
          let newStart = startIdx + 1;
          while (
            newStart < endIdx &&
            !visibleVersions.has(versionsDesc[newStart])
          )
            newStart++;
          if (newStart >= endIdx) return prev; // no visible item found
          return [versionsDesc[newStart], versionsDesc[endIdx]].sort(
            (a, b) => a - b,
          );
        }
        if (idx === endIdx) {
          let newEnd = endIdx - 1;
          while (
            newEnd > startIdx &&
            !visibleVersions.has(versionsDesc[newEnd])
          )
            newEnd--;
          if (newEnd <= startIdx) return prev; // no visible item found
          return [versionsDesc[startIdx], versionsDesc[newEnd]].sort(
            (a, b) => a - b,
          );
        }
        return prev;
      }

      if (prevIndices.length > 0) {
        // Clicking within the range: shorten by moving the nearer endpoint.
        // versionsDesc is newest-first, so startIdx (lower) = newer, endIdx (higher) = older.
        // Tiebreaker: move the newer (top) endpoint.
        if (idx > startIdx && idx < endIdx) {
          const distToNewer = idx - startIdx;
          const distToOlder = endIdx - idx;
          if (distToNewer <= distToOlder) {
            return [versionsDesc[idx], versionsDesc[endIdx]].sort(
              (a, b) => a - b,
            );
          } else {
            return [versionsDesc[startIdx], versionsDesc[idx]].sort(
              (a, b) => a - b,
            );
          }
        }

        // If 4+ positions outside the current range, clear and pair with the
        // item immediately below (older) instead of expanding.
        if (idx <= startIdx - 4 || idx >= endIdx + 4) {
          if (idx < versionsDesc.length - 1) {
            return [versionsDesc[idx + 1], versionsDesc[idx]].sort(
              (a, b) => a - b,
            );
          }
          // Clicked the very last (oldest) revision — round up to the two newest
          if (versionsDesc.length >= 2) {
            return [versionsDesc[1], versionsDesc[0]].sort((a, b) => a - b);
          }
          return prev;
        }
      }

      const low = Math.min(...prev);
      const high = Math.max(...prev);
      const newLow = Math.min(low, version);
      const newHigh = Math.max(high, version);
      // Store only the two endpoints; selectedSorted derives all intermediate visible versions.
      return [newLow, newHigh];
    });
  };

  const hasDiscardedRevisions = useMemo(
    () => revisionList.some((r) => r.status === "discarded"),
    [revisionList],
  );
  const hasDraftRevisions = useMemo(
    () => revisionList.some((r) => DRAFT_REVISION_STATUSES.includes(r.status)),
    [revisionList],
  );

  // Returns true when a revision is a draft whose base is not the current live
  // version — publishing it would use a 3-way merge, so the diff shown may
  // not match the actual published result.
  const isOutOfOrderDraft = useCallback(
    (rev: FeatureRevisionInterface | null): boolean => {
      if (!rev) return false;
      return (
        DRAFT_REVISION_STATUSES.includes(rev.status) &&
        rev.baseVersion !== liveVersion
      );
    },
    [liveVersion],
  );

  const revisionListByVersion = useMemo(
    () => new Map(filteredRevisionList.map((r) => [r.version, r])),
    [filteredRevisionList],
  );

  const mostRecentDraftVersion = useMemo(() => {
    const drafts = filteredRevisionList.filter((r) =>
      DRAFT_REVISION_STATUSES.includes(r.status),
    );
    if (drafts.length === 0) return null;
    return Math.max(...drafts.map((r) => r.version));
  }, [filteredRevisionList]);

  const quickActionRanges = useMemo(() => {
    const draftLow =
      mostRecentDraftVersion && liveVersion
        ? Math.min(mostRecentDraftVersion, liveVersion)
        : null;
    const draftHigh =
      mostRecentDraftVersion && liveVersion
        ? Math.max(mostRecentDraftVersion, liveVersion)
        : null;
    const draftRange: number[] | null =
      draftLow &&
      draftHigh &&
      draftLow !== draftHigh &&
      versionsAsc.includes(draftLow) &&
      versionsAsc.includes(draftHigh)
        ? [draftLow, draftHigh]
        : null;
    const prevLockedVersion = revisionList
      .filter((r) => r.status === "published" && r.version < liveVersion)
      .reduce<
        number | null
      >((best, r) => (best === null || r.version > best ? r.version : best), null);
    const liveRange: number[] | null =
      prevLockedVersion !== null && versionsAsc.includes(liveVersion)
        ? [prevLockedVersion, liveVersion]
        : null;
    const allRange: number[] | null =
      versionsAsc.length >= 2
        ? [versionsAsc[0], versionsAsc[versionsAsc.length - 1]]
        : null;
    return { draftRange, liveRange, allRange };
  }, [mostRecentDraftVersion, liveVersion, versionsAsc, revisionList]);

  const currentStep = steps[safeDiffPage];
  const stepRevA = currentStep ? getFullRevision(currentStep[0]) : null;
  const stepRevB = currentStep ? getFullRevision(currentStep[1]) : null;

  // Versions needed by whichever diff view is currently shown
  const displayVersions =
    steps.length === 0
      ? []
      : diffViewMode === "steps" && currentStep
        ? [currentStep[0], currentStep[1]]
        : selectedSorted.length >= 2
          ? [selectedSorted[0], selectedSorted[selectedSorted.length - 1]]
          : [];
  const displayLoading = displayVersions.some((v) => loadingVersions.has(v));
  const displayFailed = displayVersions.filter((v) => isVersionFailed(v));
  const stepDiffs = useFeatureRevisionDiff({
    current: stepRevA
      ? revisionToDiffInput(stepRevA)
      : { defaultValue: "", rules: {} },
    draft: stepRevB
      ? revisionToDiffInput(stepRevB)
      : { defaultValue: "", rules: {} },
  });

  const singleRevFirst =
    selectedSorted.length >= 2 ? getFullRevision(selectedSorted[0]) : null;
  const singleRevLast =
    selectedSorted.length >= 2
      ? getFullRevision(selectedSorted[selectedSorted.length - 1])
      : null;
  const mergedDiffs = useFeatureRevisionDiff({
    current: singleRevFirst
      ? revisionToDiffInput(singleRevFirst)
      : { defaultValue: "", rules: {} },
    draft: singleRevLast
      ? revisionToDiffInput(singleRevLast)
      : { defaultValue: "", rules: {} },
  });

  return (
    <Modal
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
          {(quickActionRanges.draftRange ||
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
                {quickActionRanges.draftRange && (
                  <Box
                    className={`${styles.row} ${isRangeEqual(selectedSorted, quickActionRanges.draftRange) ? styles.rowSelected : ""}`}
                    onClick={() =>
                      quickActionRanges.draftRange &&
                      applyQuickAction(quickActionRanges.draftRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">Most recent draft changes</Text>
                      <Text size="small" color="text-low">
                        Revisions {quickActionRanges.draftRange[0]}{" "}
                        <PiArrowsLeftRightBold />{" "}
                        {
                          quickActionRanges.draftRange[
                            quickActionRanges.draftRange.length - 1
                          ]
                        }
                      </Text>
                    </Flex>
                  </Box>
                )}
                {quickActionRanges.liveRange && (
                  <Box
                    className={`${styles.row} ${isRangeEqual(selectedSorted, quickActionRanges.liveRange) ? styles.rowSelected : ""}`}
                    onClick={() =>
                      quickActionRanges.liveRange &&
                      applyQuickAction(quickActionRanges.liveRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">Most recent live changes</Text>
                      <Text size="small" color="text-low">
                        Revisions {quickActionRanges.liveRange[0]}{" "}
                        <PiArrowsLeftRightBold />{" "}
                        {quickActionRanges.liveRange[1]}
                      </Text>
                    </Flex>
                  </Box>
                )}
                {quickActionRanges.allRange && (
                  <Box
                    className={`${styles.row} ${isRangeEqual(selectedSorted, quickActionRanges.allRange) ? styles.rowSelected : ""}`}
                    onClick={() =>
                      quickActionRanges.allRange &&
                      applyQuickAction(quickActionRanges.allRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">All changes</Text>
                      <Text size="small" color="text-low">
                        Revisions {quickActionRanges.allRange[0]}{" "}
                        <PiArrowsLeftRightBold />{" "}
                        {
                          quickActionRanges.allRange[
                            quickActionRanges.allRange.length - 1
                          ]
                        }
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
              {versionsDesc.map((v) => {
                const minRev = revisionListByVersion.get(v);
                const fullRev = getFullRevision(v);
                const showBase = isOutOfOrderDraft(fullRev);
                const date =
                  minRev?.status === "published"
                    ? minRev?.datePublished
                    : minRev?.dateUpdated;
                const isSelected = selectedSortedSet.has(v);
                const rowId = `compare-rev-${v}`;
                return (
                  <Box
                    key={v}
                    asChild
                    className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
                  >
                    <label htmlFor={rowId}>
                      <span style={{ pointerEvents: "none" }}>
                        <Checkbox
                          id={rowId}
                          value={isSelected}
                          setValue={() => toggleVersion(v)}
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
                          <Flex align="center" gap="1">
                            {isSelected && isVersionFailed(v) && (
                              <Tooltip body="Could not load revision">
                                <PiWarningBold
                                  style={{
                                    color: "var(--red-9)",
                                    flexShrink: 0,
                                  }}
                                />
                              </Tooltip>
                            )}
                            <Text weight="semibold">Revision {v}</Text>
                          </Flex>
                          {minRev ? (
                            <RevisionStatusBadge
                              revision={minRev}
                              liveVersion={liveVersion}
                            />
                          ) : null}
                        </Flex>
                        {date && minRev ? (
                          <Text size="small" color="text-low">
                            {datetime(date)} ·{" "}
                            <EventUser user={minRev.createdBy} display="name" />
                          </Text>
                        ) : null}
                        {showBase && fullRev && fullRev.baseVersion !== 0 ? (
                          <HelperText status="info" size="sm" mt="1">
                            based on: {fullRev.baseVersion}
                          </HelperText>
                        ) : null}
                      </Flex>
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
          {steps.length === 0 ? (
            <Text color="text-low">
              Select at least two revisions in the list to see the diff.
            </Text>
          ) : (
            <>
              <Flex align="center" justify="between" mb="3" gap="4" wrap="wrap">
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
                          onClick={() => setDiffPage((p) => Math.max(0, p - 1))}
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
                  {diffViewMode === "single" && selectedSorted.length >= 2 && (
                    <RevisionCompareLabel
                      versionA={selectedSorted[0]}
                      versionB={selectedSorted[selectedSorted.length - 1]}
                      revA={singleRevFirst}
                      revB={singleRevLast}
                      liveVersion={liveVersion}
                      revAFailed={isVersionFailed(selectedSorted[0])}
                      revBFailed={isVersionFailed(
                        selectedSorted[selectedSorted.length - 1],
                      )}
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
                    disabled={!canToggleDiffView}
                    size="2"
                    mb="0"
                  >
                    <SelectItem value="steps">Steps</SelectItem>
                    <SelectItem value="single">Single diff</SelectItem>
                  </Select>
                </Flex>
              </Flex>
              <>
                {diffViewMode === "steps" && currentStep && (
                  <RevisionCompareLabel
                    versionA={currentStep[0]}
                    versionB={currentStep[1]}
                    revA={stepRevA}
                    revB={stepRevB}
                    liveVersion={liveVersion}
                    revAFailed={isVersionFailed(currentStep[0])}
                    revBFailed={isVersionFailed(currentStep[1])}
                    mb="3"
                  />
                )}
                {displayLoading ? (
                  <LoadingOverlay />
                ) : displayFailed.length > 0 ? (
                  <Callout status="error" contentsAs="div" mt="4">
                    <Flex gap="4" align="start">
                      <span>
                        Could not load revision
                        {displayFailed.length > 1 ? "s" : ""}{" "}
                        {displayFailed.join(", ")}.
                      </span>
                      <Link onClick={() => fetchRevisions(displayFailed)}>
                        Reload revision{displayFailed.length > 1 ? "s" : ""}
                      </Link>
                    </Flex>
                  </Callout>
                ) : (
                  <>
                    {(diffViewMode === "single"
                      ? isOutOfOrderDraft(singleRevFirst) ||
                        isOutOfOrderDraft(singleRevLast)
                      : isOutOfOrderDraft(stepRevA) ||
                        isOutOfOrderDraft(stepRevB)) && (
                      <Callout status="info" size="sm" mb="4">
                        A draft in this comparison is based on an older version
                        than what is currently live. When you publish, it will
                        be merged with the live version, so the result may
                        differ from the diff shown here.
                      </Callout>
                    )}
                    {(diffViewMode === "single" ? mergedDiffs : stepDiffs)
                      .length === 0 ? (
                      <Text color="text-low">
                        No changes between these revisions.
                      </Text>
                    ) : (
                      <Flex direction="column" gap="4">
                        {(diffViewMode === "single"
                          ? mergedDiffs
                          : stepDiffs
                        ).map((d) => (
                          <ExpandableDiff
                            key={d.title}
                            title={d.title}
                            a={d.a}
                            b={d.b}
                            defaultOpen
                          />
                        ))}
                      </Flex>
                    )}
                  </>
                )}
              </>
            </>
          )}
        </Box>
      </Flex>
    </Modal>
  );
}
