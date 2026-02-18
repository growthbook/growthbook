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
  PiArrowClockwise,
  PiWarningBold,
  PiCaretDownBold,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import format from "date-fns/format";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import { ExpandableDiff } from "@/components/Features/DraftModal";
import { useAuditEntries } from "@/hooks/useAuditEntries";
import { getChangedSectionLabels, useAuditDiff } from "./useAuditDiff";
import { AuditDiffConfig, CoarsenedAuditEntry, GroupByOption } from "./types";
import styles from "./CompareAuditEventsModal.module.scss";

const STORAGE_KEY_PREFIX = "audit:compare-events";

interface AuditEntryCompareLabelProps<T> {
  entryA: CoarsenedAuditEntry<T> | null;
  entryB: CoarsenedAuditEntry<T> | null;
  labelA: string;
  labelB: string;
  entryAFailed?: boolean;
  entryBFailed?: boolean;
  mb?: "1" | "2" | "3" | "4";
}

function AuditEntryCompareLabel<T>({
  entryA,
  entryB,
  labelA,
  labelB,
  entryAFailed = false,
  entryBFailed = false,
  mb,
}: AuditEntryCompareLabelProps<T>) {
  return (
    <Flex align="center" gap="4" wrap="nowrap" mb={mb}>
      <Flex direction="column">
        <Flex align="center" gap="1">
          {entryAFailed && (
            <Tooltip body="Could not load entry">
              <PiWarningBold style={{ color: "var(--red-9)", flexShrink: 0 }} />
            </Tooltip>
          )}
          <Text weight="semibold" size="medium">
            {labelA}
          </Text>
        </Flex>
        {entryA && (
          <Text as="div" size="small" color="text-low">
            {datetime(entryA.dateStart)}
          </Text>
        )}
      </Flex>
      <PiArrowsLeftRightBold size={16} />
      <Flex direction="column">
        <Flex align="center" gap="1">
          {entryBFailed && (
            <Tooltip body="Could not load entry">
              <PiWarningBold style={{ color: "var(--red-9)", flexShrink: 0 }} />
            </Tooltip>
          )}
          <Text weight="semibold" size="medium">
            {labelB}
          </Text>
        </Flex>
        {entryB && (
          <Text as="div" size="small" color="text-low">
            {datetime(entryB.dateStart)}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}

function getSeparatorBucketKey(date: Date, groupBy: GroupByOption): string {
  if (groupBy === "day") {
    return format(date, "yyyy-MM-dd");
  }
  // "minute" and "hour" both use hour-level separators
  return format(date, "yyyy-MM-dd-HH");
}

function getSeparatorLabel(date: Date, groupBy: GroupByOption): string {
  const isCurrentYear = date.getFullYear() === new Date().getFullYear();
  if (groupBy === "day") {
    return format(date, isCurrentYear ? "MMM d" : "MMM d, yyyy");
  }
  return format(date, isCurrentYear ? "MMM d · h aaa" : "MMM d, yyyy · h aaa");
}

export interface CompareAuditEventsModalProps<T> {
  entityId: string;
  config: AuditDiffConfig<T>;
  /** Human-readable map from event string to display name, e.g. "experiment.start" → "Started" */
  eventLabels?: Record<string, string>;
  onClose: () => void;
}

export default function CompareAuditEventsModal<T>({
  entityId,
  config,
  eventLabels = {},
  onClose,
}: CompareAuditEventsModalProps<T>) {
  const [diffViewModeRaw, setDiffViewModeRaw] = useLocalStorage<string>(
    `${STORAGE_KEY_PREFIX}:diffViewMode`,
    "steps",
  );
  const diffViewMode = diffViewModeRaw === "single" ? "single" : "steps";

  // ---- Section visibility toggles ----
  // All sections are visible by default; a missing key means "visible".
  const [visibleSections, setVisibleSections] = useLocalStorage<
    Record<string, boolean>
  >(`${STORAGE_KEY_PREFIX}:${config.entityType}:visibleSections`, {});

  const sectionLabels = useMemo(
    () => [
      ...(config.sections ?? []).map((s) => s.label),
      // "Other changes" is auto-emitted by useAuditDiff when sections exist
      ...(config.sections?.length ? ["Other changes"] : []),
    ],
    [config],
  );

  const isSectionVisible = useCallback(
    (label: string) => visibleSections[label] !== false,
    [visibleSections],
  );

  const toggleSection = useCallback(
    (label: string) =>
      setVisibleSections((prev) => ({
        ...prev,
        [label]: prev[label] === false,
      })),
    [setVisibleSections],
  );

  const {
    entries,
    loading,
    loadingAll,
    error,
    hasMore,
    total,
    loadMore,
    loadAll,
    expandEntry,
    groupBy,
    setGroupBy,
  } = useAuditEntries<T>(config, entityId);

  // Track which coarsened groups are currently expanded in-place.
  // Key = coarsened entry id; value = expanded individual entries.
  const [expandedGroups, setExpandedGroups] = useState<
    Record<string, CoarsenedAuditEntry<T>[]>
  >({});

  const expandGroup = useCallback(
    (entry: CoarsenedAuditEntry<T>) => {
      const children = expandEntry(entry);
      setExpandedGroups((prev) => ({ ...prev, [entry.id]: children }));
      // If the group was selected, replace its id with all child ids so they
      // all appear checked after expansion.
      setSelectedIds((prev) => {
        if (!prev.includes(entry.id)) return prev;
        const childIds = children.map((c) => c.id);
        return prev.flatMap((id) => (id === entry.id ? childIds : [id]));
      });
    },
    [expandEntry],
  );

  // Reset expanded groups whenever the grouping bucket changes. Also mark the
  // selection as "default" so that the flatEntries effect below will snap it
  // back to the top two entries once the new coarsened list arrives.
  useEffect(() => {
    setExpandedGroups({});
    isDefaultPairRef.current = true;
  }, [groupBy]);

  // Flatten the coarsened list: replace expanded groups with their children
  const flatEntries = useMemo(() => {
    const result: CoarsenedAuditEntry<T>[] = [];
    for (const e of entries) {
      const expanded = expandedGroups[e.id];
      if (expanded) {
        result.push(...expanded);
      } else {
        result.push(e);
      }
    }
    return result;
  }, [entries, expandedGroups]);

  const getEventLabel = useCallback(
    (event: string) => eventLabels[event] ?? event,
    [eventLabels],
  );

  // ---- Selection ----
  const flatIds = useMemo(() => flatEntries.map((e) => e.id), [flatEntries]);

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (flatEntries.length < 2) return flatEntries.map((e) => e.id);
    return [flatEntries[0].id, flatEntries[1].id];
  });

  // When new entries load, if selection is still the default pair, stay pointing
  // at the two newest entries.
  const isDefaultPairRef = useRef(true);
  useEffect(() => {
    if (!isDefaultPairRef.current) return;
    if (flatEntries.length >= 2) {
      setSelectedIds([flatEntries[0].id, flatEntries[1].id]);
    }
  }, [flatEntries]);

  // When a far-click lands on the last loaded item and more pages exist, we
  // store the id here, load more, and resolve once the next item appears.
  const [pendingPairId, setPendingPairId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingPairId) return;
    const idx = flatIds.indexOf(pendingPairId);
    if (idx === -1) return;
    if (idx < flatIds.length - 1) {
      // The next item is now loaded — complete the pair
      setSelectedIds([flatIds[idx], flatIds[idx + 1]]);
      isDefaultPairRef.current = false;
      setPendingPairId(null);
    } else if (!hasMore) {
      // No more pages — round up to the two newest
      if (flatIds.length >= 2) {
        setSelectedIds([flatIds[0], flatIds[1]]);
        isDefaultPairRef.current = false;
      }
      setPendingPairId(null);
    }
    // else: still loading more; wait for flatIds to update again
  }, [flatIds, pendingPairId, hasMore]);

  const selectedSorted = useMemo(() => {
    // Keep in the order they appear in flatEntries (newest-first in array,
    // but conceptually oldest → newest for diffing)
    return flatIds.filter((id) => selectedIds.includes(id));
  }, [flatIds, selectedIds]);

  // For step navigation — walk adjacent pairs newest→oldest in display order,
  // but diff as earlier→later snapshot
  const steps = useMemo(() => {
    // selectedSorted is in display order (newest first).
    // Reverse to get oldest→newest, then build adjacent pairs.
    const ascending = [...selectedSorted].reverse();
    const pairs: [string, string][] = [];
    for (let i = 0; i < ascending.length - 1; i++) {
      pairs.push([ascending[i], ascending[i + 1]]);
    }
    // Reverse again so step 1 = most recent change (newest pair first)
    return pairs.reverse();
  }, [selectedSorted]);

  const [diffPage, setDiffPage] = useState(0);
  const safeDiffPage = Math.min(
    Math.max(0, diffPage),
    Math.max(0, steps.length - 1),
  );

  useEffect(() => {
    setDiffPage((p) =>
      steps.length === 0 ? 0 : Math.min(p, steps.length - 1),
    );
  }, [steps.length]);

  const canToggleDiffView = selectedSorted.length > 2;

  const entryById = useMemo(
    () => new Map(flatEntries.map((e) => [e.id, e])),
    [flatEntries],
  );

  const toggleSelection = useCallback(
    (id: string) => {
      const idx = flatIds.indexOf(id);
      if (idx === -1) return;

      // Determine if this is a "far click" (4+ positions outside the current
      // selection range) using a snapshot of the current selection.
      const currentIndices = selectedIds
        .map((sid) => flatIds.indexOf(sid))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);
      const isFarClick =
        currentIndices.length === 0 ||
        idx <= currentIndices[0] - 4 ||
        idx >= currentIndices[currentIndices.length - 1] + 4;

      // Far click on the last loaded item when more pages exist: trigger a
      // fetch and resolve the pair once the next item appears.
      if (isFarClick && idx === flatIds.length - 1 && hasMore) {
        setPendingPairId(id);
        loadMore();
        isDefaultPairRef.current = false;
        return;
      }

      isDefaultPairRef.current = false;
      setSelectedIds((prev) => {
        const low = flatIds.indexOf(prev[0] ?? "");
        const high = flatIds.indexOf(prev[prev.length - 1] ?? "");

        if (prev.includes(id)) {
          if (prev.length <= 2) return prev;
          // Split — keep the larger side
          const left = prev.filter((sid) => flatIds.indexOf(sid) < idx);
          const right = prev.filter((sid) => flatIds.indexOf(sid) > idx);
          if (left.length >= 2 && right.length >= 2)
            return left.length >= right.length ? left : right;
          if (left.length >= 2) return left;
          if (right.length >= 2) return right;
          return prev;
        }

        // Far click: clear the selection and pair with the item immediately
        // below (older). Round up to [0, 1] if clicking the last loaded item.
        if (low !== -1 && high !== -1 && (idx <= low - 4 || idx >= high + 4)) {
          if (idx < flatIds.length - 1) {
            return [flatIds[idx], flatIds[idx + 1]];
          }
          return flatIds.length >= 2 ? [flatIds[0], flatIds[1]] : prev;
        }

        const newLow = Math.min(low === -1 ? idx : low, idx);
        const newHigh = Math.max(high === -1 ? idx : high, idx);
        const result = flatIds.slice(newLow, newHigh + 1);
        // Guard: stale/invalid prev can produce a 1-item slice — fall back to
        // the default pair so the UI is never left with a single selection.
        if (result.length < 2 && flatIds.length >= 2) {
          return [flatIds[0], flatIds[1]];
        }
        return result;
      });
    },
    [flatIds, selectedIds, hasMore, loadMore],
  );

  // ---- Failed entry tracking ----
  // An entry is "failed" if its postSnapshot is null (could not parse details)
  const isEntryFailed = useCallback(
    (id: string) => {
      const e = entryById.get(id);
      return !!e && e.postSnapshot === null;
    },
    [entryById],
  );

  // ---- Current diff inputs ----
  const currentStep = steps[safeDiffPage] ?? null;
  const stepEntryA = currentStep
    ? (entryById.get(currentStep[0]) ?? null)
    : null;
  const stepEntryB = currentStep
    ? (entryById.get(currentStep[1]) ?? null)
    : null;

  const singleEntryFirst =
    selectedSorted.length >= 2
      ? (entryById.get(selectedSorted[selectedSorted.length - 1]) ?? null)
      : null;
  const singleEntryLast =
    selectedSorted.length >= 2
      ? (entryById.get(selectedSorted[0]) ?? null)
      : null;

  // For diffing: pre of step A is its postSnapshot, post of step B is its postSnapshot.
  // For a create entry (pre=null), show as "created with these values".
  const stepDiffs = useAuditDiff<T>({
    pre: stepEntryA?.postSnapshot ?? null,
    post: stepEntryB?.postSnapshot ?? null,
    config,
  });

  const mergedDiffs = useAuditDiff<T>({
    pre: singleEntryFirst?.postSnapshot ?? null,
    post: singleEntryLast?.postSnapshot ?? null,
    config,
  });

  // ---- Display state ----
  const displayIds =
    steps.length === 0
      ? []
      : diffViewMode === "steps" && currentStep
        ? [currentStep[0], currentStep[1]]
        : selectedSorted.length >= 2
          ? [selectedSorted[selectedSorted.length - 1], selectedSorted[0]]
          : [];
  const displayFailed = displayIds.filter((id) => isEntryFailed(id));

  // ---- Quick actions ----
  const applyQuickAction = useCallback((ids: string[]) => {
    isDefaultPairRef.current = false;
    setSelectedIds(ids);
    setDiffPage(0);
  }, []);

  const handleLoadAll = useCallback(async () => {
    await loadAll();
    // After loading all, select everything
    setSelectedIds(flatIds);
    isDefaultPairRef.current = false;
  }, [loadAll, flatIds]);

  // ---- Per-entry changed section labels ----
  // Computed once over all flat entries; avoids calling a hook in a loop.
  const entrySectionLabels = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of flatEntries) {
      if (config.sections?.length) {
        const labels = getChangedSectionLabels(
          entry.preSnapshot,
          entry.postSnapshot,
          config,
        );
        map.set(entry.id, labels);
      }
    }
    return map;
  }, [flatEntries, config]);

  // ---- Filtered entry list for the left column ----
  // Hide entries whose changed sections are entirely invisible.
  // Entries with no section changes (e.g. create events) are always shown.
  const visibleFlatEntries = useMemo(() => {
    if (!sectionLabels.length) return flatEntries;
    return flatEntries.filter((entry) => {
      const changed = entrySectionLabels.get(entry.id);
      if (!changed?.length) return true;
      return changed.some(isSectionVisible);
    });
  }, [flatEntries, entrySectionLabels, sectionLabels, isSectionVisible]);

  // When section toggles cause visibleFlatEntries to shrink, ensure the
  // selection still contains at least 2 visible entries; if not, reset to
  // the top 2 visible entries.
  useEffect(() => {
    const visibleIds = new Set(visibleFlatEntries.map((e) => e.id));
    setSelectedIds((prev) => {
      const valid = prev.filter((id) => visibleIds.has(id));
      if (valid.length >= 2) return valid.length === prev.length ? prev : valid;
      if (visibleFlatEntries.length >= 2) {
        return [visibleFlatEntries[0].id, visibleFlatEntries[1].id];
      }
      return visibleFlatEntries.map((e) => e.id);
    });
  }, [visibleFlatEntries]);

  // ---- Render helpers ----
  const getEntryLabel = useCallback(
    (entry: CoarsenedAuditEntry<T>) => {
      const base = getEventLabel(entry.event);
      const sections = (entrySectionLabels.get(entry.id) ?? []).filter(
        isSectionVisible,
      );
      return sections.length ? `${base}: ${sections.join(", ")}` : base;
    },
    [getEventLabel, entrySectionLabels, isSectionVisible],
  );

  const renderEntryRow = (entry: CoarsenedAuditEntry<T>) => {
    const isSelected = selectedIds.includes(entry.id);
    const failed = isEntryFailed(entry.id);
    const label = getEventLabel(entry.event);
    const rowId = `audit-entry-${entry.id}`;

    return (
      <Box
        key={entry.id}
        asChild
        className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
      >
        <label htmlFor={rowId}>
          <span style={{ pointerEvents: "none" }}>
            <Checkbox
              id={rowId}
              value={isSelected}
              setValue={() => toggleSelection(entry.id)}
            />
          </span>
          <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
            <Flex align="center" justify="between" gap="2" width="100%">
              <Flex align="center" gap="1">
                {isSelected && failed && (
                  <Tooltip body="Could not load entry">
                    <PiWarningBold
                      style={{ color: "var(--red-9)", flexShrink: 0 }}
                    />
                  </Tooltip>
                )}
                <Text weight="semibold">
                  {(() => {
                    const changed = (
                      entrySectionLabels.get(entry.id) ?? []
                    ).filter(isSectionVisible);
                    if (!changed.length) return label;
                    return `${label}: ${changed.join(", ")}`;
                  })()}
                </Text>
              </Flex>
              {entry.count > 1 && (
                <Badge
                  label={String(entry.count)}
                  color="violet"
                  variant="soft"
                  title={`${entry.count} changes merged`}
                />
              )}
            </Flex>
            <Text size="small" color="text-low">
              {entry.count > 1
                ? datetime(entry.dateEnd)
                : datetime(entry.dateStart)}{" "}
              · <EntryUserName user={entry.user} />
            </Text>
            {entry.count > 1 && (
              <Box mt="1">
                <Link
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    expandGroup(entry);
                  }}
                >
                  <PiCaretDownBold
                    style={{ display: "inline", marginRight: 4 }}
                  />
                  {`Expand ${entry.count} changes`}
                </Link>
              </Box>
            )}
          </Flex>
        </label>
      </Box>
    );
  };

  const activeDiffs = useMemo(
    () =>
      (diffViewMode === "single" ? mergedDiffs : stepDiffs).filter((d) =>
        isSectionVisible(d.label),
      ),
    [diffViewMode, mergedDiffs, stepDiffs, isSectionVisible],
  );

  return (
    <Modal
      trackingEventModalType="compare-audit-events"
      open={true}
      header="Compare changes"
      close={onClose}
      hideCta
      includeCloseCta
      closeCta="Close"
      size="max"
      sizeY="max"
      bodyClassName="p-0"
    >
      <Flex style={{ flex: 1, minHeight: 0 }}>
        {/* Left column */}
        <Box
          style={{ width: 300, minWidth: 300, minHeight: 0 }}
          className={`${styles.sidebar} ${styles.sidebarLeft} overflow-auto`}
        >
          {/* Quick actions */}
          {flatEntries.length >= 2 && (
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
                {flatEntries.length >= 2 && (
                  <Box
                    className={`${styles.row} ${
                      selectedSorted.length === 2 &&
                      selectedSorted[0] === flatEntries[0].id &&
                      selectedSorted[1] === flatEntries[1].id
                        ? styles.rowSelected
                        : ""
                    }`}
                    onClick={() =>
                      applyQuickAction([flatEntries[0].id, flatEntries[1].id])
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1">
                      <Text weight="semibold">Most recent change</Text>
                      <Text size="small" color="text-low">
                        {getEventLabel(flatEntries[1].event)}{" "}
                        <PiArrowsLeftRightBold />{" "}
                        {getEventLabel(flatEntries[0].event)}
                      </Text>
                    </Flex>
                  </Box>
                )}
                <Box
                  className={`${styles.row} ${
                    selectedSorted.length === flatIds.length && !hasMore
                      ? styles.rowSelected
                      : ""
                  }`}
                  onClick={async () => {
                    if (hasMore) {
                      await handleLoadAll();
                    } else {
                      applyQuickAction(flatIds);
                    }
                  }}
                >
                  <Box className={styles.rowSpacer} />
                  <Flex direction="column" gap="1">
                    <Flex align="center" gap="2">
                      <Text weight="semibold">All changes</Text>
                      {loadingAll && (
                        <PiArrowClockwise
                          style={{
                            animation: "spin 1s linear infinite",
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </Flex>
                    <Text size="small" color="text-low">
                      {total} total
                    </Text>
                  </Flex>
                </Box>
              </Flex>
            </Box>
          )}

          {/* Group by + entry list */}
          <Box className={styles.section} pb="3">
            <Flex align="center" justify="between" mb="2">
              <Text
                size="medium"
                weight="medium"
                color="text-mid"
                mb="2"
                as="p"
              >
                Select range of revisions
              </Text>
            </Flex>
            <Flex align="center" gap="2" mb={sectionLabels.length ? "2" : "3"}>
              <Text color="text-low" weight="medium">
                Group by
              </Text>
              <Select
                value={groupBy}
                setValue={(v) => setGroupBy(v as GroupByOption)}
                size="2"
                mb="0"
              >
                <SelectItem value="minute">Minute</SelectItem>
                <SelectItem value="hour">Hour</SelectItem>
                <SelectItem value="day">Day</SelectItem>
              </Select>
            </Flex>

            {sectionLabels.length > 0 && (
              <Flex direction="column" gap="2" mb="3">
                {sectionLabels.map((label) => (
                  <Flex key={label} gap="2" justify="end" align="center">
                    <Text size="small" color="text-low">
                      {label}
                    </Text>
                    <Switch
                      size="1"
                      value={isSectionVisible(label)}
                      onChange={() => toggleSection(label)}
                    />
                  </Flex>
                ))}
              </Flex>
            )}

            {loading && !flatEntries.length ? (
              <LoadingOverlay />
            ) : error ? (
              <Callout status="error">{error}</Callout>
            ) : flatEntries.length === 0 ? (
              <Text color="text-low">No change history found.</Text>
            ) : visibleFlatEntries.length === 0 ? (
              <Text color="text-low">
                No changes match the current section filters.
              </Text>
            ) : (
              <Flex direction="column" className={styles.revisionsList}>
                {visibleFlatEntries.reduce<React.ReactNode[]>(
                  (nodes, entry, i) => {
                    const prev = visibleFlatEntries[i - 1];
                    const bucketKey = getSeparatorBucketKey(
                      entry.dateStart,
                      groupBy,
                    );
                    const prevBucketKey = prev
                      ? getSeparatorBucketKey(prev.dateStart, groupBy)
                      : null;
                    if (prevBucketKey === null || bucketKey !== prevBucketKey) {
                      nodes.push(
                        <Flex
                          key={`sep-${entry.id}`}
                          align="center"
                          gap="2"
                          px="2"
                          py="1"
                        >
                          <Box
                            style={{
                              flex: 1,
                              height: 1,
                              background: "var(--gray-6)",
                            }}
                          />
                          <Text size="medium" weight="medium" color="text-low">
                            {getSeparatorLabel(entry.dateStart, groupBy)}
                          </Text>
                          <Box
                            style={{
                              flex: 1,
                              height: 1,
                              background: "var(--gray-6)",
                            }}
                          />
                        </Flex>,
                      );
                    }
                    nodes.push(renderEntryRow(entry));
                    return nodes;
                  },
                  [],
                )}
                {hasMore && (
                  <Box mt="2">
                    <Link onClick={loadMore} color="violet">
                      {loading ? (
                        <PiArrowClockwise
                          style={{ animation: "spin 1s linear infinite" }}
                        />
                      ) : null}{" "}
                      Load more
                    </Link>
                  </Box>
                )}
              </Flex>
            )}
          </Box>
        </Box>

        {/* Right column */}
        <Box
          flexGrow="1"
          position="relative"
          className={`${styles.sidebar} overflow-auto`}
          style={{ minHeight: 0 }}
        >
          {steps.length === 0 ? (
            <Text color="text-low">
              Select at least two entries in the list to see the diff.
            </Text>
          ) : (
            <>
              {/* Header row */}
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
                  {diffViewMode === "single" &&
                    singleEntryFirst &&
                    singleEntryLast && (
                      <AuditEntryCompareLabel
                        entryA={singleEntryFirst}
                        entryB={singleEntryLast}
                        labelA={getEntryLabel(singleEntryFirst)}
                        labelB={getEntryLabel(singleEntryLast)}
                        entryAFailed={isEntryFailed(singleEntryFirst.id)}
                        entryBFailed={isEntryFailed(singleEntryLast.id)}
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

              {/* Step label */}
              {diffViewMode === "steps" && stepEntryA && stepEntryB && (
                <AuditEntryCompareLabel
                  entryA={stepEntryA}
                  entryB={stepEntryB}
                  labelA={getEntryLabel(stepEntryA)}
                  labelB={getEntryLabel(stepEntryB)}
                  entryAFailed={isEntryFailed(stepEntryA.id)}
                  entryBFailed={isEntryFailed(stepEntryB.id)}
                  mb="3"
                />
              )}

              {/* Diff content */}
              {displayFailed.length > 0 ? (
                <Callout status="error" contentsAs="div" mt="4">
                  <Flex direction="column" gap="2" align="start">
                    <span>
                      Could not load change
                      {displayFailed.length > 1 ? "s" : ""}.
                    </span>
                    <Link
                      onClick={() => {
                        // Nothing to retry for audit entries — details are static
                        // in the audit log. Surface as info instead.
                      }}
                    >
                      The audit record may be missing snapshot data.
                    </Link>
                  </Flex>
                </Callout>
              ) : activeDiffs.length === 0 ? (
                <Text color="text-low">No changes between these entries.</Text>
              ) : (
                <Flex direction="column" gap="4">
                  {activeDiffs.map((d) => (
                    <Box key={d.label}>
                      {d.customRender && <Box mb="2">{d.customRender}</Box>}
                      <ExpandableDiff
                        title={d.label}
                        a={d.a}
                        b={d.b}
                        defaultOpen
                      />
                    </Box>
                  ))}
                </Flex>
              )}
            </>
          )}
        </Box>
      </Flex>
    </Modal>
  );
}

function EntryUserName({
  user,
}: {
  user: CoarsenedAuditEntry<unknown>["user"];
}) {
  if (user.type === "system") return <>System</>;
  if (user.type === "apikey") return <>API Key</>;
  return <>{user.name || user.email || "Unknown user"}</>;
}
