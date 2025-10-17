import { useMemo } from "react";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { MetricOverride } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
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
} from "shared/experiments";
import { isDefined } from "shared/util";
import { useGrowthBook } from "@growthbook/growthbook-react";
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
import { useUser } from "@/services/UserContext";
import { AppFeatures } from "@/types/app-features";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";

export interface UseExperimentTableRowsParams {
  // Core experiment data
  results: ExperimentReportResultDimension;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];

  // Feature flags and permissions
  ssrPolyfills?: SSRPolyfills;

  // Slice configuration
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  pinnedMetricSlices?: string[];

  // Filtering and sorting
  metricFilter?: ResultsMetricFilters;
  sortBy?: "metric-tags" | "significance" | "change" | null;
  sortDirection?: "asc" | "desc" | null;
  analysisBarSettings?: {
    variationFilter: number[];
  };

  // Statistical settings
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];

  // UI behavior
  shouldShowMetricSlices?: boolean;
  enableExpansion?: boolean; // Whether to allow expand/collapse of slices
  enablePinning?: boolean; // Whether to allow pinning of slices

  // External expansion state (required when enableExpansion is true)
  expandedMetrics: Record<string, boolean>;
  toggleExpandedMetric: (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
}

export interface UseExperimentTableRowsReturn {
  rows: ExperimentTableRow[];
  expandedMetrics: Record<string, boolean>;
  toggleExpandedMetric: (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
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
  analysisBarSettings,
  statsEngine,
  pValueCorrection,
  settingsForSnapshotMetrics,
  shouldShowMetricSlices = true,
  enableExpansion: _enableExpansion = true,
  enablePinning = true,
  expandedMetrics,
  toggleExpandedMetric,
}: UseExperimentTableRowsParams): UseExperimentTableRowsReturn {
  const { getExperimentMetricById, getFactTableById, metricGroups, ready } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();
  const growthbook = useGrowthBook<AppFeatures>();
  const { metricDefaults } = useOrganizationMetricDefaults();

  // Feature flag and commercial feature checks for slice analysis
  const isMetricSlicesFeatureEnabled = growthbook?.isOn("metric-slices");
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");
  const _shouldShowMetricSlices =
    shouldShowMetricSlices &&
    isMetricSlicesFeatureEnabled &&
    hasMetricSlicesFeature;

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
    const allMetricTagsSet: Set<string> = new Set();
    [...expandedGoals, ...expandedSecondaries, ...expandedGuardrails].forEach(
      (metricId) => {
        const metric =
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId);
        metric?.tags?.forEach((tag) => {
          allMetricTagsSet.add(tag);
        });
      },
    );
    return [...allMetricTagsSet];
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
        shouldShowMetricSlices: _shouldShowMetricSlices,
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
    _shouldShowMetricSlices,
    customMetricSlices,
    enablePinning,
    sortBy,
    sortDirection,
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
    expandedMetrics,
    toggleExpandedMetric,
    allMetricTags,
    getChildRowCounts,
  };
}

// Shared row generation logic that can be used by both normal and dimension hooks
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
  settingsForSnapshotMetrics: MetricSnapshotSettings[] | undefined;
  shouldShowMetricSlices: boolean;
  customMetricSlices:
    | Array<{
        slices: Array<{
          column: string;
          levels: string[];
        }>;
      }>
    | undefined;
  pinnedMetricSlices: string[] | undefined;
  expandedMetrics: Record<string, boolean>;
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

  if (shouldShowMetricSlices) {
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

  // Update numSlices with actual count
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
      const isExpanded = expandedMetrics[expandedKey] || false;

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
      const isPinned = pinnedMetricSlices?.includes(pinnedKey) || false;

      // Show level if metric is expanded OR if it's pinned
      const shouldShowLevel = isExpanded || isPinned;

      // Generate label from slice levels
      const label = slice.sliceLevels
        .map((dl, index) => {
          const content = (() => {
            if (dl.levels.length === 0) {
              // For "other" slice, show "column: NULL" with small caps styling
              return `${dl.column}: null`;
            }
            const value = dl.levels[0];
            // Only use colon notation for boolean columns
            if (dl.datatype === "boolean") {
              return `${dl.column}: ${value}`;
            }
            return value;
          })();

          return content + (index < slice.sliceLevels.length - 1 ? " + " : "");
        })
        .join("");

      const sliceRow: ExperimentTableRow = {
        label,
        metric: {
          ...newMetric,
          name: slice.name, // Use the full slice metric name
        },
        metricOverrideFields: overrideFields,
        rowClass: `${newMetric?.inverse ? "inverse" : ""} slice-row`,
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
