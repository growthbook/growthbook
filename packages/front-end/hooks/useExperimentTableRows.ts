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
} from "shared/experiments";
import { isDefined } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
  compareRows,
} from "@/services/experiments";
import {
  ResultsMetricFilters,
  sortAndFilterMetricsByTags,
} from "@/components/Experiment/Results";
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
  metricFilter?: ResultsMetricFilters;
  sortBy?: "metric-tags" | "significance" | "change" | "custom" | null;
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
  metricFilter,
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
      const expandedGoals = expandMetricGroups(
        goalMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedSecondaries = expandMetricGroups(
        secondaryMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedGuardrails = expandMetricGroups(
        guardrailMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );

      return { expandedGoals, expandedSecondaries, expandedGuardrails };
    }, [
      goalMetrics,
      metricGroups,
      ssrPolyfills?.metricGroups,
      secondaryMetrics,
      guardrailMetrics,
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
    // Only use tag-based sorting when sortBy is "metric-tags"
    const sortedFilteredMetrics =
      sortBy === "metric-tags"
        ? sortAndFilterMetricsByTags(metricDefs, metricFilter)
        : sortBy === "custom" && customMetricOrder
          ? sortMetricsByCustomOrder(metricDefs, customMetricOrder)
          : metricDefs.map((m) => m.id);

    const secondaryDefs = expandedSecondaries
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);
    const sortedFilteredSecondary =
      sortBy === "metric-tags"
        ? sortAndFilterMetricsByTags(secondaryDefs, metricFilter)
        : sortBy === "custom" && customMetricOrder
          ? sortMetricsByCustomOrder(secondaryDefs, customMetricOrder)
          : secondaryDefs.map((m) => m.id);

    const guardrailDefs = expandedGuardrails
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);
    const sortedFilteredGuardrails =
      sortBy === "metric-tags"
        ? sortAndFilterMetricsByTags(guardrailDefs, metricFilter)
        : sortBy === "custom" && customMetricOrder
          ? sortMetricsByCustomOrder(guardrailDefs, customMetricOrder)
          : guardrailDefs.map((m) => m.id);

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
    metricFilter,
    pinnedMetricSlices,
    expandedMetrics,
    shouldShowMetricSlices,
    customMetricSlices,
    enablePinning,
    sortBy,
    sortDirection,
    customMetricOrder,
    analysisBarSettings?.variationFilter,
    metricDefaults,
  ]);

  const getChildRowCounts = (metricId: string) => {
    const childRows = rows.filter((row) => row.parentRowId === metricId);
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

  const parentRow: ExperimentTableRow = {
    label: newMetric?.name,
    metric: newMetric,
    metricOverrideFields: overrideFields,
    rowClass: newMetric?.inverse ? "inverse" : "",
    variations: resultsArray[0].variations.map((v) => {
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
  };

  const rows: ExperimentTableRow[] = [parentRow];

  if (numSlices > 0) {
    sliceData.forEach((slice) => {
      const expandedKey = `${metricId}:${resultGroup}`;
      const isExpanded = !!expandedMetrics?.[expandedKey];

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

      const shouldShowLevel = isExpanded || isPinned;

      const label = slice.sliceLevels
        .map((dl, _index) => {
          if (dl.levels.length === 0) {
            return `${dl.column}: null`;
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
        isHiddenByFilter: !shouldShowLevel, // Always add slice rows to the array, even if hidden by filter
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
  }

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
