import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
// eslint-disable-next-line no-restricted-imports
import { Box, Checkbox as RadixCheckbox, Flex } from "@radix-ui/themes";
import {
  PiArrowsLeftRightBold,
  PiClockClockwise,
  PiWarningBold,
  PiCaretDownBold,
  PiCaretRightFill,
  PiX,
} from "react-icons/pi";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { datetime } from "shared/dates";
import format from "date-fns/format";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import LoadingOverlay from "@/components/LoadingOverlay";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import { ExpandableDiff } from "@/components/Features/DraftModal";
import { PAGE_LIMIT, useAuditEntries } from "@/hooks/useAuditEntries";
import { getChangedSectionLabels, useAuditDiff } from "./useAuditDiff";
import {
  AuditDiffConfig,
  AuditEventMarker,
  CoarsenedAuditEntry,
  GroupByOption,
} from "./types";
import styles from "./CompareAuditEventsModal.module.scss";

const STORAGE_KEY_PREFIX = "audit:compare-events";

// Section labels suppressed from left-column entry titles (too noisy or redundant).
const HIDDEN_LABEL_SECTIONS = new Set(["other changes", "Phase info"]);

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
            {datetime(entryA.dateStart)} · <EntryUserName user={entryA.user} />
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
            {datetime(entryB.dateStart)} · <EntryUserName user={entryB.user} />
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
  return format(date, isCurrentYear ? "MMM d" : "MMM d, yyyy");
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
  const diffViewModeStored = diffViewModeRaw === "single" ? "single" : "steps";

  // ---- Section visibility toggles ----
  // All sections are visible by default; a missing key means "visible".
  const [visibleSections, setVisibleSections] = useLocalStorage<
    Record<string, boolean>
  >(`${STORAGE_KEY_PREFIX}:${config.entityType}:visibleSections`, {
    "other changes": false,
  });

  // Non-diffable event markers (e.g. "Refreshed analysis") are hidden by default.
  const [showOtherEvents, setShowOtherEvents] = useLocalStorage<boolean>(
    `${STORAGE_KEY_PREFIX}:${config.entityType}:showOtherEvents`,
    false,
  );

  const sectionLabels = useMemo(
    () => [
      // Deduplicate: multiple sections may share a label (for multi-widget diffs)
      ...new Set((config.sections ?? []).map((s) => s.label)),
      // "other changes" is auto-emitted by useAuditDiff when sections exist
      ...(config.sections?.length ? ["other changes"] : []),
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
    markers,
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
      // If the group was a selected endpoint, replace it with the appropriate
      // boundary child to maintain exactly 2 endpoints.
      // prev[0] is the newer endpoint, prev[1] is the older endpoint.
      setSelectedIds((prev) => {
        if (!prev.includes(entry.id)) return prev;
        const childIds = children.map((c) => c.id);
        if (childIds.length === 0) return prev;
        return prev.map((id, i) =>
          id === entry.id
            ? i === 0
              ? childIds[0] // newer endpoint → newest child
              : childIds[childIds.length - 1] // older endpoint → oldest child
            : id,
        );
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
    // selectedIds holds exactly 2 endpoints; expand to include every entry
    // between them (filter-agnostic) so steps and diffs cover the full range.
    if (selectedIds.length < 2)
      return flatIds.filter((id) => selectedIds.includes(id));
    const i0 = flatIds.indexOf(selectedIds[0]);
    const i1 = flatIds.indexOf(selectedIds[1]);
    if (i0 === -1 || i1 === -1)
      return flatIds.filter((id) => selectedIds.includes(id));
    return flatIds.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
  }, [flatIds, selectedIds]);

  const selectedSortedSet = useMemo(
    () => new Set(selectedSorted),
    [selectedSorted],
  );

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

  const entryById = useMemo(
    () => new Map(flatEntries.map((e) => [e.id, e])),
    [flatEntries],
  );

  // Uses the union of changed sections across every raw sub-event snapshot so
  // that sections which cancel out net-wise still appear in the title.
  const entrySectionLabels = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of flatEntries) {
      if (config.sections?.length) {
        const seen = new Set<string>();
        for (const { pre, post } of entry.rawSnapshots) {
          for (const label of getChangedSectionLabels(pre, post, config)) {
            seen.add(label);
          }
        }
        map.set(entry.id, Array.from(seen));
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

  const visibleIdSet = useMemo(
    () => new Set(visibleFlatEntries.map((e) => e.id)),
    [visibleFlatEntries],
  );

  const toggleSelection = useCallback(
    (id: string) => {
      const idx = flatIds.indexOf(id);
      if (idx === -1) return;

      // Count visible items strictly between two flat indices (exclusive).
      const visibleBetween = (a: number, b: number): number => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        let count = 0;
        for (let i = lo + 1; i < hi; i++) {
          if (visibleIdSet.has(flatIds[i])) count++;
        }
        return count;
      };

      // Determine if this is a "far click" (4+ visible items between the clicked
      // item and the nearest current selection endpoint).
      const currentIndices = selectedIds
        .map((sid) => flatIds.indexOf(sid))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);
      const isFarClick =
        currentIndices.length === 0 ||
        (idx < currentIndices[0] &&
          visibleBetween(idx, currentIndices[0]) >= 4) ||
        (idx > currentIndices[currentIndices.length - 1] &&
          visibleBetween(currentIndices[currentIndices.length - 1], idx) >= 4);

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

        // Clicking an endpoint shrinks the range to the nearest visible item inward.
        // flatIds[low] is the newer (top) endpoint; flatIds[high] is the older (bottom).
        if (prev.includes(id)) {
          if (high === low) return prev; // already at minimum 1 item
          if (idx === low) {
            let newLow = low + 1;
            while (newLow <= high && !visibleIdSet.has(flatIds[newLow]))
              newLow++;
            if (newLow > high) return prev; // no visible item found
            // newLow === high collapses to a single-item selection
            return [flatIds[newLow], flatIds[high]];
          }
          if (idx === high) {
            let newHigh = high - 1;
            while (newHigh >= low && !visibleIdSet.has(flatIds[newHigh]))
              newHigh--;
            if (newHigh < low) return prev; // no visible item found
            // newHigh === low collapses to a single-item selection
            return [flatIds[low], flatIds[newHigh]];
          }
          return prev;
        }

        // Clicking within the range: shorten by moving the nearer endpoint.
        // Tiebreaker: move the newer (top) endpoint. flatIds[low] is newer.
        if (low !== -1 && high !== -1 && idx > low && idx < high) {
          const distToNewer = idx - low;
          const distToOlder = high - idx;
          if (distToNewer <= distToOlder) {
            return [flatIds[idx], flatIds[high]];
          } else {
            return [flatIds[low], flatIds[idx]];
          }
        }

        // Far click: jump to single-item view for the clicked entry.
        if (
          low !== -1 &&
          high !== -1 &&
          ((idx < low && visibleBetween(idx, low) >= 4) ||
            (idx > high && visibleBetween(high, idx) >= 4))
        ) {
          return [flatIds[idx], flatIds[idx]];
        }

        const newLow = Math.min(low === -1 ? idx : low, idx);
        const newHigh = Math.max(high === -1 ? idx : high, idx);
        // Store only the two endpoints; selectedSorted derives the full range.
        if (newLow === newHigh && flatIds.length >= 2) {
          return [flatIds[0], flatIds[1]];
        }
        return [flatIds[newLow], flatIds[newHigh]];
      });
    },
    [flatIds, selectedIds, hasMore, loadMore, visibleIdSet],
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
    selectedSorted.length >= 1
      ? (entryById.get(selectedSorted[selectedSorted.length - 1]) ?? null)
      : null;
  const singleEntryLast =
    selectedSorted.length >= 1
      ? (entryById.get(selectedSorted[0]) ?? null)
      : null;
  const isSingleEntry = selectedSorted.length === 1;
  // Single-entry selection has no steps — always use merged diff view.
  const diffViewMode = isSingleEntry ? "single" : diffViewModeStored;

  // For diffing: pre of step A is its postSnapshot, post of step B is its postSnapshot.
  // For a create entry (pre=null), show as "created with these values".
  const stepDiffs = useAuditDiff<T>({
    pre: stepEntryA?.postSnapshot ?? null,
    post: stepEntryB?.postSnapshot ?? null,
    config,
  });

  // When a single entry is selected, diff its own preSnapshot→postSnapshot.
  // For multi-entry ranges, use oldest.postSnapshot→newest.postSnapshot (merged net diff).
  const mergedDiffs = useAuditDiff<T>({
    pre: isSingleEntry
      ? (singleEntryFirst?.preSnapshot ?? null)
      : (singleEntryFirst?.postSnapshot ?? null),
    post: singleEntryLast?.postSnapshot ?? null,
    config,
  });

  // ---- Display state ----
  const displayIds =
    isSingleEntry && singleEntryFirst
      ? [singleEntryFirst.id]
      : steps.length === 0
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

  // When loadAll completes, flatIds from the closure is stale. Use a ref so a
  // useEffect can apply the selection once the fresh flatIds is available.
  const pendingSelectAllRef = useRef(false);
  const handleLoadAll = useCallback(async () => {
    pendingSelectAllRef.current = true;
    isDefaultPairRef.current = false;
    await loadAll();
  }, [loadAll]);
  useEffect(() => {
    if (!pendingSelectAllRef.current) return;
    if (hasMore || loadingAll) return;
    pendingSelectAllRef.current = false;
    if (flatIds.length >= 2) {
      setSelectedIds([flatIds[0], flatIds[flatIds.length - 1]]);
    }
  }, [hasMore, loadingAll, flatIds]);

  // ---- Per-entry changed section labels ----
  // Mixed list for rendering: visible entries interleaved with noise-group
  // placeholders (hidden changes + marker events) so date separators still
  // appear across filtered-out / non-diffable items.
  type NoiseItem = {
    type: "noise";
    /** Date of the first (most recent) item added to this group. */
    date: Date;
    hiddenCount: number;
    /** Per-event-type marker rollups, in insertion order. */
    markers: { event: string; label: string; count: number }[];
  };
  type LeftColItem =
    | { type: "entry"; entry: CoarsenedAuditEntry<T> }
    | NoiseItem
    | { type: "marker"; marker: AuditEventMarker };

  const leftColumnItems = useMemo((): LeftColItem[] => {
    // Merge-sort flatEntries and markers newest-first into one stream.
    type MergedItem =
      | { date: Date; kind: "entry"; entry: CoarsenedAuditEntry<T> }
      | { date: Date; kind: "marker"; marker: AuditEventMarker };

    const merged: MergedItem[] = [
      ...flatEntries.map(
        (entry): MergedItem => ({
          date: entry.dateStart,
          kind: "entry",
          entry,
        }),
      ),
      ...markers.map(
        (marker): MergedItem => ({ date: marker.date, kind: "marker", marker }),
      ),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const items: LeftColItem[] = [];

    // Selected endpoints are always shown as full entry rows regardless of filters,
    // so the user always sees what they've selected.
    const selectedEndpoints = new Set(selectedIds);

    // Active noise group: accumulates hidden entries + markers within a monthly bucket.
    // Flushed whenever a visible entry appears or the month changes.
    type NoiseGroup = {
      weekBucket: string;
      date: Date;
      hiddenCount: number;
      markersByEvent: Map<string, { label: string; count: number }>;
      markerEventOrder: string[];
    };
    let noise: NoiseGroup | null = null;

    const flushNoise = () => {
      if (!noise) return;
      items.push({
        type: "noise",
        date: noise.date,
        hiddenCount: noise.hiddenCount,
        markers: noise.markerEventOrder.map((ev) => ({
          event: ev,
          label: noise!.markersByEvent.get(ev)!.label,
          count: noise!.markersByEvent.get(ev)!.count,
        })),
      });
      noise = null;
    };

    // Monthly bucket key for coarsening noise groups.
    const monthBucket = (date: Date) => format(date, "yyyy-MM");

    for (const item of merged) {
      if (item.kind === "marker") {
        // Always-visible markers are never collapsed into a noise group.
        if (item.marker.alwaysVisible) {
          flushNoise();
          items.push({ type: "marker", marker: item.marker });
          continue;
        }
        const bucket = monthBucket(item.marker.date);
        if (noise && noise.weekBucket !== bucket) flushNoise();
        if (!noise) {
          noise = {
            weekBucket: bucket,
            date: item.date,
            hiddenCount: 0,
            markersByEvent: new Map(),
            markerEventOrder: [],
          };
        }
        const existing = noise.markersByEvent.get(item.marker.event);
        if (existing) {
          existing.count++;
        } else {
          noise.markersByEvent.set(item.marker.event, {
            label: item.marker.label,
            count: 1,
          });
          noise.markerEventOrder.push(item.marker.event);
        }
        continue;
      }

      // Diffable entry
      const entry = item.entry;
      const changed = entrySectionLabels.get(entry.id);
      const isVisible =
        !sectionLabels.length ||
        !changed?.length ||
        changed.some(isSectionVisible) ||
        selectedEndpoints.has(entry.id) || // endpoints always visible
        config.alwaysVisibleEvents?.includes(entry.event);

      if (isVisible) {
        flushNoise();
        items.push({ type: "entry", entry });
      } else {
        const bucket = monthBucket(entry.dateStart);
        if (noise && noise.weekBucket !== bucket) flushNoise();
        if (!noise) {
          noise = {
            weekBucket: bucket,
            date: item.date,
            hiddenCount: 0,
            markersByEvent: new Map(),
            markerEventOrder: [],
          };
        }
        noise.hiddenCount++;
      }
    }
    flushNoise();
    return items;
  }, [
    flatEntries,
    markers,
    entrySectionLabels,
    sectionLabels,
    isSectionVisible,
    selectedIds,
    config.alwaysVisibleEvents,
  ]);

  // Selection is filter-agnostic: filters only affect visual grouping in the
  // left column, not which entries contribute to the diff range.

  // ---- Render helpers ----
  const getEntryLabel = useCallback(
    (entry: CoarsenedAuditEntry<T>) => {
      if (config.overrideEventLabel) {
        const override = config.overrideEventLabel(entry);
        if (override !== null) return override;
      }
      const base = getEventLabel(entry.event);
      const isUpdateEvent =
        !config.updateEventNames ||
        config.updateEventNames.includes(entry.event);
      if (isUpdateEvent) {
        const sections = (entrySectionLabels.get(entry.id) ?? []).filter(
          (s) => !HIDDEN_LABEL_SECTIONS.has(s),
        );
        return sections.length ? `${base}: ${sections.join(", ")}` : base;
      }
      return config.entityLabel ? `${base} ${config.entityLabel}` : base;
    },
    [getEventLabel, entrySectionLabels, config],
  );

  const renderEntryRow = (entry: CoarsenedAuditEntry<T>) => {
    const isSelected = selectedSortedSet.has(entry.id);
    const isExclusivelySelected =
      selectedIds[0] === entry.id &&
      selectedIds[selectedIds.length - 1] === entry.id;
    const failed = isEntryFailed(entry.id);
    const label = getEventLabel(entry.event);

    return (
      <Box
        key={entry.id}
        className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
        onClick={() => toggleSelection(entry.id)}
      >
        {!isExclusivelySelected && (
          <div className={styles.viewSingleWrapper}>
            <Button
              variant="outline"
              size="xs"
              className={styles.viewSingleButton}
              onClick={async (e) => {
                e?.preventDefault();
                e?.stopPropagation();
                isDefaultPairRef.current = false;
                setSelectedIds([entry.id, entry.id]);
                setDiffPage(0);
              }}
            >
              View
            </Button>
          </div>
        )}
        <div
          className={styles.filterCheckbox}
          style={{ marginTop: -6, marginLeft: -6 }}
          onClick={(e) => {
            e.stopPropagation();
            toggleSelection(entry.id);
          }}
        >
          <RadixCheckbox
            checked={isSelected}
            style={{ pointerEvents: "none" }}
          />
        </div>
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
                  const isUpdateEvent =
                    !config.updateEventNames ||
                    config.updateEventNames.includes(entry.event);
                  if (!isUpdateEvent) return label;
                  const changed = (
                    entrySectionLabels.get(entry.id) ?? []
                  ).filter((s) => !HIDDEN_LABEL_SECTIONS.has(s));
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
      </Box>
    );
  };

  const activeDiffs = useMemo(
    () => (diffViewMode === "single" ? mergedDiffs : stepDiffs),
    [diffViewMode, mergedDiffs, stepDiffs],
  );

  // Group customRenders by section label in order of first occurrence.
  // Companion diffs are excluded (they never carry custom renders anyway).
  const customRenderGroups = useMemo(() => {
    const seen = new Set<string>();
    const groups: { label: string; renders: React.ReactNode[] }[] = [];
    for (const d of activeDiffs) {
      if (!d.customRender || d.isCompanion) continue;
      if (!seen.has(d.label)) {
        seen.add(d.label);
        groups.push({ label: d.label, renders: [] });
      }
      groups.find((g) => g.label === d.label)!.renders.push(d.customRender);
    }
    return groups;
  }, [activeDiffs]);

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
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">Most recent change</Text>
                      <Text size="small" color="text-low" as="div">
                        <span
                          style={{
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            width: "100%",
                          }}
                        >
                          {getEntryLabel(flatEntries[0])}
                        </span>
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
                      applyQuickAction([
                        flatIds[0],
                        flatIds[flatIds.length - 1],
                      ]);
                    }
                  }}
                >
                  <Box className={styles.rowSpacer} />
                  <Flex direction="column" gap="1">
                    <Flex align="center" gap="2">
                      <Text weight="semibold">All changes</Text>
                      {loadingAll && <LoadingSpinner />}
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
              <Text size="medium" weight="medium" color="text-mid">
                Select range of revisions
              </Text>
              {sectionLabels.length > 0 &&
                (() => {
                  const isDefaultVisible = (l: string) => l !== "other changes";
                  const activeFilterCount = sectionLabels.filter(
                    (l) => !isSectionVisible(l),
                  ).length;
                  const isShowingAll =
                    activeFilterCount === 0 && showOtherEvents;
                  const isAtDefault =
                    sectionLabels.every(
                      (l) => isSectionVisible(l) === isDefaultVisible(l),
                    ) && !showOtherEvents;
                  return (
                    <DropdownMenu
                      modal={true}
                      trigger={
                        <Link>
                          Filters
                          {activeFilterCount > 0 && (
                            <Badge
                              color="indigo"
                              variant="solid"
                              radius="full"
                              label={String(activeFilterCount)}
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
                            setVisibleSections(
                              sectionLabels.reduce<Record<string, boolean>>(
                                (acc, l) => ({ ...acc, [l]: true }),
                                {},
                              ),
                            );
                            setShowOtherEvents(true);
                          }}
                        >
                          <Flex align="center" gap="1">
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
                          setVisibleSections(
                            sectionLabels.reduce<Record<string, boolean>>(
                              (acc, l) => ({
                                ...acc,
                                [l]: isDefaultVisible(l),
                              }),
                              {},
                            ),
                          );
                          setShowOtherEvents(false);
                        }}
                      >
                        <Flex align="center" gap="1">
                          <span style={{ width: 24, display: "inline-flex" }}>
                            <PiClockClockwise size={16} />
                          </span>
                          {isAtDefault
                            ? "Using default filters"
                            : "Use default filters"}
                        </Flex>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {sectionLabels.map((label) => {
                        const isOnlyVisible =
                          isSectionVisible(label) &&
                          sectionLabels.every(
                            (l) => l === label || !isSectionVisible(l),
                          );
                        return (
                          <DropdownMenuItem
                            key={label}
                            // Row click = show only this section
                            onClick={() => {
                              if (!isOnlyVisible) {
                                setVisibleSections(
                                  sectionLabels.reduce<Record<string, boolean>>(
                                    (acc, l) => ({ ...acc, [l]: l === label }),
                                    {},
                                  ),
                                );
                              }
                            }}
                          >
                            <Flex align="center" gap="1">
                              <div
                                className={`rt-CheckboxItem ${styles.filterCheckbox}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSection(label);
                                }}
                              >
                                <RadixCheckbox
                                  checked={isSectionVisible(label)}
                                  color="violet"
                                />
                              </div>
                              Show {label}
                            </Flex>
                          </DropdownMenuItem>
                        );
                      })}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setShowOtherEvents(!showOtherEvents)}
                      >
                        <Flex align="center" gap="1">
                          <div
                            className={`rt-CheckboxItem ${styles.filterCheckbox}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowOtherEvents(!showOtherEvents);
                            }}
                          >
                            <RadixCheckbox
                              checked={showOtherEvents}
                              color="violet"
                            />
                          </div>
                          Show other events
                        </Flex>
                      </DropdownMenuItem>
                    </DropdownMenu>
                  );
                })()}
            </Flex>
            <Flex align="center" gap="2" mb="3">
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

            {loading && !flatEntries.length ? (
              <LoadingOverlay />
            ) : error ? (
              <Callout status="error">{error}</Callout>
            ) : flatEntries.length === 0 ? (
              <Text color="text-low">No change history found.</Text>
            ) : (
              <Flex direction="column" className={styles.revisionsList}>
                {leftColumnItems.reduce<React.ReactNode[]>((nodes, item, i) => {
                  const prev = leftColumnItems[i - 1];
                  const getItemDate = (it: LeftColItem) =>
                    it.type === "entry"
                      ? it.entry.dateStart
                      : it.type === "marker"
                        ? it.marker.date
                        : it.date;
                  const date = getItemDate(item);
                  const prevDate = prev ? getItemDate(prev) : null;
                  const bucketKey = getSeparatorBucketKey(date, groupBy);
                  const prevBucketKey = prevDate
                    ? getSeparatorBucketKey(prevDate, groupBy)
                    : null;
                  if (prevBucketKey === null || bucketKey !== prevBucketKey) {
                    nodes.push(
                      <Flex
                        key={`sep-${i}`}
                        align="center"
                        gap="2"
                        px="2"
                        py="1"
                        style={{ width: 200 }}
                      >
                        <Box
                          style={{
                            flex: 1,
                            height: 1,
                            background: "var(--gray-6)",
                          }}
                        />
                        <Text size="small" weight="medium" color="text-low">
                          {getSeparatorLabel(date, groupBy)}
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
                  if (item.type === "entry") {
                    nodes.push(renderEntryRow(item.entry));
                  } else if (item.type === "marker") {
                    nodes.push(
                      <Flex
                        key={`marker-${item.marker.id}`}
                        align="center"
                        px="2"
                        py="1"
                      >
                        <Text color="text-low" size="small">
                          {item.marker.label}
                        </Text>
                      </Flex>,
                    );
                  } else {
                    // Noise item: hidden diffable changes + collapsed markers.
                    const lines: string[] = [];
                    if (item.hiddenCount > 0) {
                      lines.push(
                        `${item.hiddenCount} ${item.hiddenCount === 1 ? "change" : "changes"} hidden`,
                      );
                    }
                    if (showOtherEvents) {
                      // Show individual marker labels.
                      for (const m of item.markers) {
                        lines.push(
                          m.count > 1 ? `${m.label} ×${m.count}` : m.label,
                        );
                      }
                    } else {
                      // Collapse all markers into a single "N events hidden" line.
                      const totalMarkers = item.markers.reduce(
                        (sum, m) => sum + m.count,
                        0,
                      );
                      if (totalMarkers > 0) {
                        lines.push(
                          `${totalMarkers} ${totalMarkers === 1 ? "event" : "events"} hidden`,
                        );
                      }
                    }
                    nodes.push(
                      <Flex
                        key={`noise-${i}`}
                        direction="column"
                        gap="1"
                        px="2"
                      >
                        {lines.map((line) => (
                          <Flex key={line} align="center">
                            <Text color="text-low" size="small">
                              {line}
                            </Text>
                          </Flex>
                        ))}
                      </Flex>,
                    );
                  }
                  return nodes;
                }, [])}
                {hasMore && (
                  <Flex gap="4" mt="1" justify="between">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={loadMore}
                      disabled={loading || loadingAll}
                    >
                      {loading && <LoadingSpinner />}
                      {`Load ${PAGE_LIMIT} more`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handleLoadAll}
                      disabled={loading || loadingAll}
                    >
                      {loadingAll && <LoadingSpinner />}
                      {`Load all (${total})`}
                    </Button>
                  </Flex>
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
          {steps.length === 0 && !isSingleEntry ? (
            <Text color="text-low">
              Select at least one entry in the list to see the diff.
            </Text>
          ) : (
            <Box pb="4">
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
                    singleEntryLast &&
                    (isSingleEntry ? (
                      <Flex direction="column">
                        <Flex align="center" gap="1">
                          {isEntryFailed(singleEntryFirst.id) && (
                            <Tooltip body="Could not load entry">
                              <PiWarningBold
                                style={{
                                  color: "var(--red-9)",
                                  flexShrink: 0,
                                }}
                              />
                            </Tooltip>
                          )}
                          <Text weight="semibold" size="medium">
                            {getEntryLabel(singleEntryFirst)}
                          </Text>
                        </Flex>
                        <Text as="div" size="small" color="text-low">
                          {datetime(singleEntryFirst.dateStart)} ·{" "}
                          <EntryUserName user={singleEntryFirst.user} />
                        </Text>
                      </Flex>
                    ) : (
                      <AuditEntryCompareLabel
                        entryA={singleEntryFirst}
                        entryB={singleEntryLast}
                        labelA={getEntryLabel(singleEntryFirst)}
                        labelB={getEntryLabel(singleEntryLast)}
                        entryAFailed={isEntryFailed(singleEntryFirst.id)}
                        entryBFailed={isEntryFailed(singleEntryLast.id)}
                      />
                    ))}
                </Flex>
                {!isSingleEntry && (
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
                )}
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
                <>
                  {/* Hoisted summaries: human-readable render per section */}
                  {customRenderGroups.length > 0 && (
                    <Box>
                      <Heading as="h5" size="small" color="text-mid" mt="5">
                        Summary of changes
                      </Heading>
                      <Flex direction="column" gap="0">
                        {customRenderGroups.map(({ label, renders }) => (
                          <Box
                            key={label}
                            p="3"
                            my="3"
                            className="rounded bg-light"
                          >
                            <Heading
                              as="h6"
                              size="small"
                              color="text-mid"
                              mb="2"
                            >
                              {label}
                            </Heading>
                            {renders.map((r, i) => (
                              <Box key={i}>{r}</Box>
                            ))}
                          </Box>
                        ))}
                      </Flex>
                    </Box>
                  )}

                  {/* Raw JSON diffs */}
                  {customRenderGroups.length > 0 && (
                    <Heading as="h5" size="small" color="text-mid" mb="3">
                      Change details
                    </Heading>
                  )}
                  <Flex direction="column" gap="4">
                    {activeDiffs.map((d, i) => (
                      <Box key={i}>
                        <ExpandableDiff
                          title={d.label}
                          a={d.a}
                          b={d.b}
                          defaultOpen={
                            !d.defaultCollapsed && isSectionVisible(d.label)
                          }
                          compact
                        />
                      </Box>
                    ))}
                  </Flex>
                </>
              )}
              {isSingleEntry && singleEntryFirst && (
                <RawAuditDetails entry={singleEntryFirst} />
              )}
            </Box>
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

function RawAuditDetails<T>({ entry }: { entry: CoarsenedAuditEntry<T> }) {
  const [open, setOpen] = useState(false);
  const pre = JSON.stringify(entry.preSnapshot ?? {}, null, 2);
  const post = JSON.stringify(entry.postSnapshot, null, 2);

  return (
    <Box mt="5">
      <div
        className="link-purple font-weight-bold"
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((o) => !o)}
      >
        <PiCaretRightFill
          style={{
            display: "inline",
            marginRight: 4,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        Full audit details
      </div>
      {open && (
        <Box mt="3">
          <Flex direction="column" gap="1" mb="4">
            {(
              [
                [
                  "Event",
                  <Badge
                    key="e"
                    label={entry.event}
                    color="violet"
                    variant="soft"
                    radius="full"
                  />,
                ],
                ["Date", datetime(entry.dateStart)],
                [
                  "Author",
                  entry.user.type === "system"
                    ? "System"
                    : entry.user.type === "apikey"
                      ? `API Key (${entry.user.apiKey ?? ""})`
                      : entry.user.name || entry.user.email || "Unknown",
                ],
                ...(entry.count > 1
                  ? [["Merged events", String(entry.count)]]
                  : []),
              ] as [string, React.ReactNode][]
            ).map(([label, value]) => (
              <Flex key={label} gap="2" align="baseline">
                <span style={{ minWidth: 80, flexShrink: 0 }}>
                  <Text size="medium" color="text-mid">
                    {label}
                  </Text>
                </span>
                <Text size="medium">{value}</Text>
              </Flex>
            ))}
          </Flex>
          <Text size="medium" weight="medium" color="text-mid" mb="1" as="div">
            Details
          </Text>
          <div className="diff-wrapper diff-wrapper-compact">
            <div className="list-group-item list-group-item-light">
              <ReactDiffViewer
                oldValue={pre}
                newValue={post}
                compareMethod={DiffMethod.LINES}
                styles={{ contentText: { wordBreak: "break-all" } }}
              />
            </div>
          </div>
        </Box>
      )}
    </Box>
  );
}
