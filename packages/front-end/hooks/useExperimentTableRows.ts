import { useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { MetricOverride } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { FactMetricInterface } from "back-end/types/fact-table";
import {
  expandMetricGroups,
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
}

export interface UseExperimentTableRowsReturn {
  rows: ExperimentTableRow[];
  expandedMetrics: Record<string, boolean>;
  toggleExpandedMetric: (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  allMetricTags: string[];
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
  enableExpansion = true,
  enablePinning = true,
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

  const [expandedMetrics, setExpandedMetrics] = useState<
    Record<string, boolean>
  >({});
  const toggleExpandedMetric = (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => {
    if (!enableExpansion) return;
    const key = `${metricId}:${resultGroup}`;
    setExpandedMetrics((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

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
      const metric =
        ssrPolyfills?.getExperimentMetricById?.(metricId) ||
        getExperimentMetricById(metricId);
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

      if (_shouldShowMetricSlices) {
        const standardSliceData = createAutoSliceDataForMetric({
          parentMetric: getExperimentMetricById(metricId),
          factTable: getFactTableById(
            (getExperimentMetricById(metricId) as FactMetricInterface)
              ?.numerator?.factTableId || "",
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
        sliceData = dedupeSliceMetrics([
          ...standardSliceData,
          ...customSliceData,
        ]);
      }

      // Update numSlices with actual count
      numSlices = sliceData.length;

      const parentRow: ExperimentTableRow = {
        label: newMetric?.name,
        metric: newMetric,
        metricOverrideFields: overrideFields,
        rowClass: newMetric?.inverse ? "inverse" : "",
        variations: results.variations.map((v) => {
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
          const isPinned =
            (enablePinning && pinnedMetricSlices?.includes(pinnedKey)) || false;

          // Show level if metric is expanded OR if it's pinned
          const shouldShowLevel = isExpanded || isPinned;

          // Generate label from slice levels - we'll create a simple string for now
          // The actual JSX rendering will be handled by the component using this hook
          const labelParts = slice.sliceLevels.map((dl, _index) => {
            if (dl.levels.length === 0) {
              return `${dl.column}: null`;
            }
            const value = dl.levels[0];
            if (dl.datatype === "boolean") {
              return `${dl.column}: ${value}`;
            }
            return value;
          });
          const label = labelParts.join(" + ");

          const sliceRow: ExperimentTableRow = {
            label,
            metric: {
              ...newMetric,
              name: slice.name, // Use the full slice metric name
            },
            metricOverrideFields: overrideFields,
            rowClass: `${newMetric?.inverse ? "inverse" : ""} slice-row`,
            variations: results.variations.map((v) => {
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
    sortBy,
    sortDirection,
    analysisBarSettings?.variationFilter,
    metricDefaults,
    enablePinning,
  ]);

  return {
    rows,
    expandedMetrics,
    toggleExpandedMetric,
    allMetricTags,
  };
}
