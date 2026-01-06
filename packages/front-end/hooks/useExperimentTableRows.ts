import { useMemo } from "react";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "shared/types/report";
import { MetricOverride } from "shared/types/experiment";
import { PValueCorrection, StatsEngine } from "shared/types/stats";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  generatePinnedSliceKey,
  createCustomSliceDataForMetric,
  createAutoSliceDataForMetric,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
  dedupeSliceMetrics,
  SliceDataForMetric,
  isFactMetric,
  generateSliceString,
  isMetricGroupId,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
  compareRows,
} from "@/services/experiments";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";

export interface UseExperimentTableRowsParams {
  results: ExperimentReportResultDimension;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  ssrPolyfills?: SSRPolyfills;
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  metricTagFilter?: string[];
  metricsFilter?: string[];
  sliceTagsFilter?: string[];
  sortBy?: "significance" | "change" | "custom" | null;
  sortDirection?: "asc" | "desc" | null;
  customMetricOrder?: string[];
  analysisBarSettings?: {
    variationFilter: number[];
  };
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  shouldShowMetricSlices?: boolean;
  enablePinning?: boolean;
  pinnedMetricSlices?: string[];
  enableExpansion?: boolean;
  expandedMetrics: Record<string, boolean>;
}

export interface UseExperimentTableRowsReturn {
  rows: ExperimentTableRow[];
  allMetricTags: string[];
  getChildRowCounts: (metricId: string) => { total: number; pinned: number };
}

export function useExperimentTableRows({
  results,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricOverrides,
  ssrPolyfills,
  customMetricSlices,
  pinnedMetricSlices,
  metricTagFilter,
  metricsFilter,
  sliceTagsFilter,
  sortBy,
  sortDirection,
  customMetricOrder,
  analysisBarSettings,
  statsEngine,
  pValueCorrection,
  settingsForSnapshotMetrics,
  shouldShowMetricSlices = true,
  enableExpansion: _enableExpansion = true,
  enablePinning = true,
  expandedMetrics,
}: UseExperimentTableRowsParams): UseExperimentTableRowsReturn {
  const {
    getExperimentMetricById: _getExperimentMetricById,
    getFactTableById: _getFactTableById,
    metricGroups: _metricGroups,
    ready,
  } = useDefinitions();

  const getExperimentMetricById =
    ssrPolyfills?.getExperimentMetricById || _getExperimentMetricById;
  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;
  const metricGroups = ssrPolyfills?.metricGroups || _metricGroups;
  const { metricDefaults } = useOrganizationMetricDefaults();

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() || _pValueThreshold;

  const { expandedGoals, expandedSecondaries, expandedGuardrails } =
    useMemo(() => {
      const allMetricGroups = ssrPolyfills?.metricGroups || metricGroups;

      // Filter by metric groups if filter is active
      let filteredGoalMetrics = goalMetrics;
      let filteredSecondaryMetrics = secondaryMetrics;
      let filteredGuardrailMetrics = guardrailMetrics;

      if (metricsFilter && metricsFilter.length > 0) {
        // Create a set of allowed metric IDs from expanded groups and individual metrics
        const allowedMetricIds = new Set<string>();
        metricsFilter.forEach((id) => {
          if (isMetricGroupId(id)) {
            const group = allMetricGroups.find((g) => g.id === id);
          if (group) {
              group.metrics.forEach((metricId) =>
                allowedMetricIds.add(metricId),
              );
            }
          } else {
            allowedMetricIds.add(id);
          }
        });

        // Filter metrics by group or allowed metric IDs
        filteredGoalMetrics = goalMetrics.filter((id) => {
          if (metricsFilter.includes(id)) return true;
          if (allowedMetricIds.has(id)) return true;
          if (isMetricGroupId(id)) {
            const group = allMetricGroups.find((g) => g.id === id);
            return group?.metrics?.some((metricId) =>
              allowedMetricIds.has(metricId),
            );
          }
          return false;
        });
        filteredSecondaryMetrics = secondaryMetrics.filter((id) => {
          if (metricsFilter.includes(id)) return true;
          if (allowedMetricIds.has(id)) return true;
          if (isMetricGroupId(id)) {
            const group = allMetricGroups.find((g) => g.id === id);
            return group?.metrics?.some((metricId) =>
              allowedMetricIds.has(metricId),
            );
          }
          return false;
        });
        filteredGuardrailMetrics = guardrailMetrics.filter((id) => {
          if (metricsFilter.includes(id)) return true;
          if (allowedMetricIds.has(id)) return true;
          if (isMetricGroupId(id)) {
            const group = allMetricGroups.find((g) => g.id === id);
            return group?.metrics?.some((metricId) =>
              allowedMetricIds.has(metricId),
            );
          }
          return false;
        });
      }

      const expandedGoals = expandMetricGroups(
        filteredGoalMetrics,
        allMetricGroups,
      );
      const expandedSecondaries = expandMetricGroups(
        filteredSecondaryMetrics,
        allMetricGroups,
      );
      const expandedGuardrails = expandMetricGroups(
        filteredGuardrailMetrics,
        allMetricGroups,
      );

      return { expandedGoals, expandedSecondaries, expandedGuardrails };
    }, [
      goalMetrics,
      metricGroups,
      ssrPolyfills?.metricGroups,
      secondaryMetrics,
      guardrailMetrics,
      metricsFilter,
    ]);

  const allMetricTags = useMemo(() => {
    return getAllMetricTags(
      expandedGoals,
      expandedSecondaries,
      expandedGuardrails,
      ssrPolyfills,
      getExperimentMetricById,
    );
  }, [
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    ssrPolyfills,
    getExperimentMetricById,
  ]);

  const rows = useMemo<ExperimentTableRow[]>(() => {
    function getRowsForMetric(
      metricId: string,
      resultGroup: "goal" | "secondary" | "guardrail",
    ): ExperimentTableRow[] {
      return generateRowsForMetric({
        metricId,
        resultGroup,
        results,
        metricOverrides,
        settingsForSnapshotMetrics,
        shouldShowMetricSlices,
        customMetricSlices,
        pinnedMetricSlices: enablePinning ? pinnedMetricSlices : undefined,
        expandedMetrics,
        getExperimentMetricById,
        getFactTableById,
        sliceTagsFilter,
      });
    }

    if (!results || !results.variations || (!ready && !ssrPolyfills)) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      // Only include goals in calculation, not secondary or guardrails
      setAdjustedPValuesOnResults([results], expandedGoals, pValueCorrection);
      setAdjustedCIs([results], pValueThreshold);
    }

    const metricDefs = expandedGoals
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);

    // Apply tag filtering first (independent of sorting)
    const filteredMetrics = filterMetricsByTags(metricDefs, metricTagFilter);

    // Apply sorting on top of filtered metrics
    const sortedFilteredMetrics =
      sortBy === "custom" && customMetricOrder
        ? sortMetricsByCustomOrder(
            metricDefs.filter((m) => filteredMetrics.includes(m.id)),
              customMetricOrder,
            )
          : filteredMetrics;

    const secondaryDefs = expandedSecondaries
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);

    // Apply tag filtering first (independent of sorting)
    const filteredSecondary = filterMetricsByTags(
      secondaryDefs,
      metricTagFilter,
    );

    // Apply sorting on top of filtered secondary metrics
    const sortedFilteredSecondary =
      sortBy === "custom" && customMetricOrder
        ? sortMetricsByCustomOrder(
            secondaryDefs.filter((m) => filteredSecondary.includes(m.id)),
              customMetricOrder,
            )
          : filteredSecondary;

    const guardrailDefs = expandedGuardrails
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);

    // Apply tag filtering first (independent of sorting)
    const filteredGuardrails = filterMetricsByTags(
      guardrailDefs,
      metricTagFilter,
    );

    // Apply sorting on top of filtered guardrail metrics
    const sortedFilteredGuardrails =
      sortBy === "custom" && customMetricOrder
        ? sortMetricsByCustomOrder(
            guardrailDefs.filter((m) => filteredGuardrails.includes(m.id)),
              customMetricOrder,
            )
          : filteredGuardrails;

    const retMetrics = sortedFilteredMetrics.flatMap((metricId) =>
      getRowsForMetric(metricId, "goal"),
    );
    const retSecondary = sortedFilteredSecondary.flatMap((metricId) =>
      getRowsForMetric(metricId, "secondary"),
    );
    const retGuardrails = sortedFilteredGuardrails.flatMap((metricId) =>
      getRowsForMetric(metricId, "guardrail"),
    );

    // Sort by significance or change if sortBy is set
    if (
      (sortBy === "significance" || sortBy === "change") &&
      metricDefaults &&
      sortDirection
    ) {
      const sortOptions = {
        sortBy,
        variationFilter: analysisBarSettings?.variationFilter ?? [],
        metricDefaults,
        sortDirection,
      };

      const sortRows = (rows: ExperimentTableRow[]) => {
        const parentRows = rows.filter((row) => !row.parentRowId);
        const sortedParents = [...parentRows].sort((a, b) =>
          compareRows(a, b, sortOptions),
        );

        const newRows: ExperimentTableRow[] = [];
        sortedParents.forEach((parent) => {
          newRows.push(parent);
          const childRows = rows.filter(
            (row) => row.parentRowId === parent.metric?.id,
          );
          const sortedChildren = [...childRows].sort((a, b) =>
            compareRows(a, b, sortOptions),
          );
          newRows.push(...sortedChildren);
        });

        return newRows;
      };

      return [
        ...sortRows(retMetrics),
        ...sortRows(retSecondary),
        ...sortRows(retGuardrails),
      ];
    }

    return [...retMetrics, ...retSecondary, ...retGuardrails];
  }, [
    results,
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    metricOverrides,
    settingsForSnapshotMetrics,
    pValueCorrection,
    pValueThreshold,
    statsEngine,
    ready,
    ssrPolyfills,
    getExperimentMetricById,
    getFactTableById,
    metricTagFilter,
    pinnedMetricSlices,
    expandedMetrics,
    shouldShowMetricSlices,
    sliceTagsFilter,
    customMetricSlices,
    enablePinning,
    sortBy,
    sortDirection,
    customMetricOrder,
    analysisBarSettings?.variationFilter,
    metricDefaults,
  ]);

  const getChildRowCounts = (metricId: string) => {
    const childRows = rows.filter(
      (row) => row.parentRowId === metricId && !row.isHiddenByFilter,
    );
    const pinnedChildRows = childRows.filter((row) => !!row.isPinned);
    return {
      total: childRows.length,
      pinned: pinnedChildRows.length,
    };
  };

  return {
    rows,
    allMetricTags,
    getChildRowCounts,
  };
}

export function generateRowsForMetric({
  metricId,
  resultGroup,
  results,
  metricOverrides,
  settingsForSnapshotMetrics,
  shouldShowMetricSlices,
  customMetricSlices,
  pinnedMetricSlices,
  expandedMetrics,
  getExperimentMetricById,
  getFactTableById,
  sliceTagsFilter,
}: {
  metricId: string;
  resultGroup: "goal" | "secondary" | "guardrail";
  results: ExperimentReportResultDimension | ExperimentReportResultDimension[];
  metricOverrides: MetricOverride[];
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  shouldShowMetricSlices: boolean;
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  pinnedMetricSlices?: string[];
  expandedMetrics?: Record<string, boolean>;
  getExperimentMetricById: (id: string) => ExperimentMetricInterface | null;
  getFactTableById: (id: string) => FactTableInterface | null;
  sliceTagsFilter?: string[];
}): ExperimentTableRow[] {
  const resultsArray = Array.isArray(results) ? results : [results];
  const metric = getExperimentMetricById(metricId);
  if (!metric) return [];

  const { newMetric, overrideFields } = applyMetricOverrides(
    metric,
    metricOverrides,
  );
  let metricSnapshotSettings: MetricSnapshotSettings | undefined;
  if (settingsForSnapshotMetrics) {
    metricSnapshotSettings = settingsForSnapshotMetrics.find(
      (s) => s.metric === metricId,
    );
  }
  // Calculate slice count (will be computed from actual slice data below)
  let numSlices = 0;

  let sliceData: SliceDataForMetric[] = [];

  if (shouldShowMetricSlices && isFactMetric(metric)) {
    const standardSliceData = createAutoSliceDataForMetric({
      parentMetric: getExperimentMetricById(metricId),
      factTable: getFactTableById(
        (getExperimentMetricById(metricId) as FactMetricInterface)?.numerator
          ?.factTableId || "",
      ),
      includeOther: true,
    });

    const customSliceData = createCustomSliceDataForMetric({
      metricId,
      metricName: newMetric?.name || "",
      customMetricSlices: customMetricSlices || [],
      factTable: getFactTableById(
        (metric as FactMetricInterface)?.numerator?.factTableId || "",
      ),
    });

    // Dedupe (auto and custom slices sometimes overlap)
    sliceData = dedupeSliceMetrics([...standardSliceData, ...customSliceData]);
  }

  numSlices = sliceData.length;

  // If slice filter is active and metric has no slices, don't show parent row (unless "overall" filter is set)
  if (
    sliceTagsFilter &&
    sliceTagsFilter.length > 0 &&
    numSlices === 0 &&
    !sliceTagsFilter.includes("overall")
  ) {
    return [];
  }

  // When slice filters are active and metric has slices, make parent row label-only (unless "overall" filter is set)
  const isLabelOnly =
    sliceTagsFilter &&
    sliceTagsFilter.length > 0 &&
    numSlices > 0 &&
    !sliceTagsFilter.includes("overall");

  const parentRow: ExperimentTableRow = {
    label: newMetric?.name,
    metric: newMetric,
    metricOverrideFields: overrideFields,
    rowClass: newMetric?.inverse ? "inverse" : "",
    variations: isLabelOnly
      ? resultsArray[0].variations.map(() => ({
          users: 0,
          value: 0,
          cr: 0,
          errorMessage: "No data",
        }))
      : resultsArray[0].variations.map((v) => {
      return (
        v.metrics?.[metricId] || {
          users: 0,
          value: 0,
          cr: 0,
          errorMessage: "No data",
        }
      );
    }),
    metricSnapshotSettings,
    resultGroup,
    numSlices,
    labelOnly: isLabelOnly,
  };

  const rows: ExperimentTableRow[] = [];

  if (numSlices > 0) {
    const expandedKey = `${metricId}:${resultGroup}`;
    // Auto-expand all metrics when slice filter is active
    const isExpanded =
      sliceTagsFilter && sliceTagsFilter.length > 0
        ? true
        : !!expandedMetrics?.[expandedKey];

    // Track if any slice matches the filter (for parent row visibility)
    let hasMatchingSlice = false;

    sliceData.forEach((slice) => {
      // Generate pinned key from all slice levels
      const pinnedSliceLevels = slice.sliceLevels.map((dl) => ({
        column: dl.column,
        datatype: dl.datatype,
        levels: dl.levels,
      }));
      const pinnedKey = generatePinnedSliceKey(
        metricId,
        pinnedSliceLevels,
        resultGroup,
      );
      const isPinned = !!pinnedMetricSlices?.includes(pinnedKey);

      // Check if slice matches filter
      let sliceMatches = true;
      if (sliceTagsFilter && sliceTagsFilter.length > 0) {
        // Check if any "select all" filter is active for columns in this slice
        const hasSelectAllFilter = slice.sliceLevels.some((sliceLevel) => {
          // "Select all" format: dim:column (no equals sign)
          const selectAllTag = `dim:${encodeURIComponent(sliceLevel.column)}`;
          return sliceTagsFilter.includes(selectAllTag);
        });

        if (hasSelectAllFilter) {
          // If "select all" is active for any column in this slice, include it
          sliceMatches = true;
          hasMatchingSlice = true;
        } else {
        // Extract slice tags from slice data
        const sliceTags: string[] = [];
        // Generate single dimension tags
        slice.sliceLevels.forEach((sliceLevel) => {
          const value = sliceLevel.levels[0] || "";
          const tag = generateSliceString({ [sliceLevel.column]: value });
          sliceTags.push(tag);
        });
        // Generate combined tag for multi-dimensional slices
        if (slice.sliceLevels.length > 1) {
          const slices: Record<string, string> = {};
          slice.sliceLevels.forEach((sl) => {
            slices[sl.column] = sl.levels[0] || "";
          });
          const comboTag = generateSliceString(slices);
          sliceTags.push(comboTag);
        }
        // Check if any slice tag matches the filter
        sliceMatches = sliceTags.some((tag) => sliceTagsFilter.includes(tag));
        if (sliceMatches) {
          hasMatchingSlice = true;
          }
        }
      }

      // Show if: (expanded or pinned) AND matches filter (no special treatment for pinned when filter is active)
      const hasFilter = sliceTagsFilter && sliceTagsFilter.length > 0;
      const shouldShowLevel = hasFilter
        ? (isExpanded || isPinned) && sliceMatches
        : isExpanded || isPinned;

      const label = slice.sliceLevels
        .map((dl, _index) => {
          if (dl.levels.length === 0) {
            const emptyValue = dl.datatype === "string" ? "other" : "null";
            return `${dl.column}: ${emptyValue}`;
          }
          const value = dl.levels[0];
          if (dl.datatype === "boolean") {
            return `${dl.column}: ${value}`;
          }
          return value;
        })
        .join(" + ");

      const sliceRow: ExperimentTableRow = {
        label,
        metric: {
          ...newMetric,
          name: slice.name,
        },
        metricOverrideFields: overrideFields,
        rowClass: `${newMetric?.inverse ? "inverse" : ""} slice-row`,
        sliceId: slice.id,
        variations: resultsArray[0].variations.map((v) => {
          // Use the slice metric's data instead of the parent metric's data
          return (
            v.metrics?.[slice.id] || {
              users: 0,
              value: 0,
              cr: 0,
              errorMessage: "No data",
            }
          );
        }),
        metricSnapshotSettings,
        resultGroup,
        numSlices: 0,
        isSliceRow: true,
        parentRowId: metricId,
        sliceLevels: slice.sliceLevels.map((dl) => ({
          column: dl.column,
          datatype: dl.datatype,
          levels: dl.levels,
        })),
        allSliceLevels: slice.allSliceLevels,
        // Only use isHiddenByFilter when there's actually a filter active
        // When no filter, expansion state is handled by rendering logic
        isHiddenByFilter: hasFilter ? !shouldShowLevel : false,
        isPinned: isPinned,
      };

      // Skip "other" slice rows with no data
      if (
        slice.sliceLevels.every((dl) => dl.levels.length === 0) &&
        sliceRow.variations.every((v) => v.value === 0)
      ) {
        return;
      }
      rows.push(sliceRow);
    });

    // If slice filter is active and no slices match, don't show parent row
    // Exception: if "overall" is in the filter, show the row anyway
    if (
      sliceTagsFilter &&
      sliceTagsFilter.length > 0 &&
      !hasMatchingSlice &&
      !sliceTagsFilter.includes("overall")
    ) {
      return [];
    }
  }

  // Add parent row only if we should show it
  rows.unshift(parentRow);

  return rows;
}

export function getAllMetricTags(
  expandedGoals: string[],
  expandedSecondaries: string[],
  expandedGuardrails: string[],
  ssrPolyfills?: SSRPolyfills,
  getExperimentMetricById?: (id: string) => ExperimentMetricInterface | null,
): string[] {
  const allMetricTagsSet: Set<string> = new Set();
  [...expandedGoals, ...expandedSecondaries, ...expandedGuardrails].forEach(
    (metricId) => {
      const metric =
        ssrPolyfills?.getExperimentMetricById?.(metricId) ||
        getExperimentMetricById?.(metricId);
      metric?.tags?.forEach((tag) => {
        allMetricTagsSet.add(tag);
      });
    },
  );
  return [...allMetricTagsSet];
}

function sortMetricsByCustomOrder(
  metrics: ExperimentMetricInterface[],
  customOrder: string[],
): string[] {
  const metricIds = metrics.map((m) => m.id);
  const orderedMetrics = customOrder.filter((id) => metricIds.includes(id));
  const unorderedMetrics = metricIds.filter((id) => !customOrder.includes(id));
  return [...orderedMetrics, ...unorderedMetrics];
}

export function filterMetricsByTags(
  metrics: ExperimentMetricInterface[],
  tagFilter?: string[],
): string[] {
  // If no filter, return all metrics
  if (!tagFilter || tagFilter.length === 0) {
    return metrics.map((m) => m.id);
  }

  return metrics
    .filter((metric) => {
      return metric.tags?.some((tag) => tagFilter.includes(tag));
    })
    .map((m) => m.id);
}
