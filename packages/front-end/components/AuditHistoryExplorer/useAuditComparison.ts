import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useAuditEntries } from "./useAuditEntries";
import { getChangedSectionLabels, useAuditDiff } from "./useAuditDiff";
import { AuditDiffConfig, AuditDiffItem, CoarsenedAuditEntry } from "./types";
import {
  buildLeftColumnItems,
  buildSteps,
  expandSelectionRange,
  resolveEntryLabel,
} from "./CompareAuditEventsUtils";

const STORAGE_KEY_PREFIX = "audit:compare-events";

// ---- Internal helpers (not exported) ----

function flattenEntries<T>(
  entries: CoarsenedAuditEntry<T>[],
  expandedGroups: Record<string, CoarsenedAuditEntry<T>[]>,
): CoarsenedAuditEntry<T>[] {
  const result: CoarsenedAuditEntry<T>[] = [];
  for (const e of entries) {
    const expanded = expandedGroups[e.id];
    if (expanded) result.push(...expanded);
    else result.push(e);
  }
  return result;
}

function buildEntrySectionLabels<T>(
  flatEntries: CoarsenedAuditEntry<T>[],
  config: AuditDiffConfig<T>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!config.sections?.length) return map;
  for (const entry of flatEntries) {
    const seen = new Set<string>();
    for (const { pre, post } of entry.rawSnapshots) {
      for (const label of getChangedSectionLabels(pre, post, config)) {
        seen.add(label);
      }
    }
    map.set(entry.id, Array.from(seen));
  }
  return map;
}

function filterVisibleEntries<T>(
  flatEntries: CoarsenedAuditEntry<T>[],
  entrySectionLabels: Map<string, string[]>,
  sectionLabels: string[],
  isSectionVisible: (label: string) => boolean,
): CoarsenedAuditEntry<T>[] {
  if (!sectionLabels.length) return flatEntries;
  return flatEntries.filter((entry) => {
    const changed = entrySectionLabels.get(entry.id);
    if (!changed?.length) return true;
    return changed.some(isSectionVisible);
  });
}

function computeSelectionToggle(
  prev: string[],
  id: string,
  flatIds: string[],
  visibleIdSet: Set<string>,
): string[] {
  const idx = flatIds.indexOf(id);
  if (idx === -1) return prev;

  const visibleBetween = (a: number, b: number): number => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    let count = 0;
    for (let i = lo + 1; i < hi; i++) {
      if (visibleIdSet.has(flatIds[i])) count++;
    }
    return count;
  };

  const low = flatIds.indexOf(prev[0] ?? "");
  const high = flatIds.indexOf(prev[prev.length - 1] ?? "");

  // Clicking an endpoint shrinks the range toward the other endpoint.
  if (prev.includes(id)) {
    if (high === low) return prev;
    if (idx === low) {
      let newLow = low + 1;
      while (newLow <= high && !visibleIdSet.has(flatIds[newLow])) newLow++;
      if (newLow > high) return prev;
      return [flatIds[newLow], flatIds[high]];
    }
    if (idx === high) {
      let newHigh = high - 1;
      while (newHigh >= low && !visibleIdSet.has(flatIds[newHigh])) newHigh--;
      if (newHigh < low) return prev;
      return [flatIds[low], flatIds[newHigh]];
    }
    return prev;
  }

  // Click within the range: move the nearer endpoint (tiebreak: move newer/top).
  if (low !== -1 && high !== -1 && idx > low && idx < high) {
    const distToNewer = idx - low;
    const distToOlder = high - idx;
    return distToNewer <= distToOlder
      ? [flatIds[idx], flatIds[high]]
      : [flatIds[low], flatIds[idx]];
  }

  // Far click (≥8 visible items away): single-item selection.
  if (
    low !== -1 &&
    high !== -1 &&
    ((idx < low && visibleBetween(idx, low) >= 8) ||
      (idx > high && visibleBetween(high, idx) >= 8))
  ) {
    return [flatIds[idx]];
  }

  // No selection or close click: extend or start a range.
  const newLow = Math.min(low === -1 ? idx : low, idx);
  const newHigh = Math.max(high === -1 ? idx : high, idx);
  if (newLow === newHigh) return [flatIds[idx]];
  return [flatIds[newLow], flatIds[newHigh]];
}

function computeGroupExpansionSelection(
  prev: string[],
  entryId: string,
  childIds: string[],
): string[] {
  if (!prev.includes(entryId) || childIds.length === 0) return prev;
  // prev[0] is the newer endpoint; prev[last] is the older endpoint.
  return prev.map((id, i) =>
    id === entryId
      ? i === 0
        ? childIds[0]
        : childIds[childIds.length - 1]
      : id,
  );
}

function groupCustomRenders(
  activeDiffs: AuditDiffItem[],
): { label: string; renders: ReactNode[] }[] {
  const seen = new Set<string>();
  const groups: { label: string; renders: ReactNode[] }[] = [];
  for (const d of activeDiffs) {
    if (!d.customRender || d.isCompanion) continue;
    if (!seen.has(d.label)) {
      seen.add(d.label);
      groups.push({ label: d.label, renders: [] });
    }
    groups.find((g) => g.label === d.label)!.renders.push(d.customRender);
  }
  return groups;
}

function computeDisplayIds(
  isSingleEntry: boolean,
  singleEntryFirst: { id: string } | null,
  steps: [string, string][],
  diffViewMode: string,
  currentStep: [string, string] | null,
  selectedSorted: string[],
): string[] {
  if (isSingleEntry && singleEntryFirst) return [singleEntryFirst.id];
  if (steps.length === 0) return [];
  if (diffViewMode === "steps" && currentStep)
    return [currentStep[0], currentStep[1]];
  const oldest = selectedSorted[selectedSorted.length - 1];
  const newest = selectedSorted[0];
  return oldest && newest ? [oldest, newest] : [];
}

// ---- Hook ----

export function useAuditComparison<T>(
  config: AuditDiffConfig<T>,
  entityId: string,
  eventLabels: Record<string, string>,
) {
  // ---- Section visibility filters ----
  const sectionLabels = useMemo(
    () => [
      ...new Set((config.sections ?? []).map((s) => s.label)),
      ...(config.sections?.length ? ["other changes"] : []),
    ],
    [config],
  );

  const [visibleSections, setVisibleSections] = useLocalStorage<
    Record<string, boolean>
  >(
    `${STORAGE_KEY_PREFIX}:${config.entityType}:visibleSections`,
    Object.fromEntries(
      (config.defaultHiddenSections ?? []).map((s) => [s, false]),
    ),
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

  // ---- Diff view mode ----
  const [diffViewModeRaw, setDiffViewModeRaw] = useLocalStorage<string>(
    `${STORAGE_KEY_PREFIX}:diffViewMode`,
    "steps",
  );
  const diffViewModeStored = diffViewModeRaw === "single" ? "single" : "steps";

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

  const [expandedGroups, setExpandedGroups] = useState<
    Record<string, CoarsenedAuditEntry<T>[]>
  >({});

  const isDefaultPairRef = useRef(true);
  useEffect(() => {
    setExpandedGroups({});
    isDefaultPairRef.current = true;
  }, [groupBy]);

  const flatEntries = useMemo(
    () => flattenEntries(entries, expandedGroups),
    [entries, expandedGroups],
  );

  const flatIds = useMemo(() => flatEntries.map((e) => e.id), [flatEntries]);

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (flatEntries.length < 2) return flatEntries.map((e) => e.id);
    return [flatEntries[0].id, flatEntries[1].id];
  });

  // When new entries load, if selection is still the default pair, stay pointing
  // at the two newest entries.
  useEffect(() => {
    if (!isDefaultPairRef.current) return;
    if (flatEntries.length >= 2) {
      setSelectedIds([flatEntries[0].id, flatEntries[1].id]);
    }
  }, [flatEntries]);

  const selectedSorted = useMemo(
    () => expandSelectionRange(flatIds, selectedIds),
    [flatIds, selectedIds],
  );

  const selectedSortedSet = useMemo(
    () => new Set(selectedSorted),
    [selectedSorted],
  );

  const steps = useMemo(() => buildSteps(selectedSorted), [selectedSorted]);

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

  const entrySectionLabels = useMemo(
    () => buildEntrySectionLabels(flatEntries, config),
    [flatEntries, config],
  );

  const visibleFlatEntries = useMemo(
    () =>
      filterVisibleEntries(
        flatEntries,
        entrySectionLabels,
        sectionLabels,
        isSectionVisible,
      ),
    [flatEntries, entrySectionLabels, sectionLabels, isSectionVisible],
  );

  const visibleIdSet = useMemo(
    () => new Set(visibleFlatEntries.map((e) => e.id)),
    [visibleFlatEntries],
  );

  const expandGroup = useCallback(
    (entry: CoarsenedAuditEntry<T>) => {
      const children = expandEntry(entry);
      setExpandedGroups((prev) => ({ ...prev, [entry.id]: children }));
      setSelectedIds((prev) =>
        computeGroupExpansionSelection(
          prev,
          entry.id,
          children.map((c) => c.id),
        ),
      );
    },
    [expandEntry],
  );

  const toggleSelection = useCallback(
    (id: string) => {
      isDefaultPairRef.current = false;
      setSelectedIds((prev) =>
        computeSelectionToggle(prev, id, flatIds, visibleIdSet),
      );
    },
    [flatIds, visibleIdSet],
  );

  // Selects exactly one entry for a focused single-entry diff view.
  const viewSingle = useCallback((id: string) => {
    isDefaultPairRef.current = false;
    setSelectedIds([id, id]);
    setDiffPage(0);
  }, []);

  const isEntryFailed = useCallback(
    (id: string) => {
      const e = entryById.get(id);
      return !!e && e.postSnapshot === null;
    },
    [entryById],
  );

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

  const activeDiffs = useMemo(
    () => (diffViewMode === "single" ? mergedDiffs : stepDiffs),
    [diffViewMode, mergedDiffs, stepDiffs],
  );

  const displayFailed = computeDisplayIds(
    isSingleEntry,
    singleEntryFirst,
    steps,
    diffViewMode,
    currentStep,
    selectedSorted,
  ).filter((id) => isEntryFailed(id));

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

  const leftColumnItems = useMemo(
    () =>
      buildLeftColumnItems(
        flatEntries,
        markers,
        entrySectionLabels,
        sectionLabels,
        isSectionVisible,
        selectedIds,
        config,
      ),
    [
      flatEntries,
      markers,
      entrySectionLabels,
      sectionLabels,
      isSectionVisible,
      selectedIds,
      config,
    ],
  );

  const getEntryLabel = useCallback(
    (entry: CoarsenedAuditEntry<T>) =>
      resolveEntryLabel(entry, config, eventLabels, entrySectionLabels),
    [config, eventLabels, entrySectionLabels],
  );

  const customRenderGroups = useMemo(
    () => groupCustomRenders(activeDiffs),
    [activeDiffs],
  );

  return {
    // Section visibility filters
    sectionLabels,
    setVisibleSections,
    isSectionVisible,
    toggleSection,
    // Loading / pagination
    loading,
    loadingAll,
    error,
    hasMore,
    total,
    loadMore,
    handleLoadAll,
    // Grouping
    groupBy,
    setGroupBy,
    // Entry list
    flatEntries,
    flatIds,
    markers,
    leftColumnItems,
    getEntryLabel,
    isEntryFailed,
    expandGroup,
    // Selection
    selectedIds,
    selectedSorted,
    selectedSortedSet,
    toggleSelection,
    viewSingle,
    applyQuickAction,
    // Step navigation
    steps,
    safeDiffPage,
    setDiffPage,
    // Diff view
    diffViewMode,
    setDiffViewModeRaw,
    activeDiffs,
    customRenderGroups,
    displayFailed,
    // Diff context
    stepEntryA,
    stepEntryB,
    singleEntryFirst,
    singleEntryLast,
    isSingleEntry,
  };
}
