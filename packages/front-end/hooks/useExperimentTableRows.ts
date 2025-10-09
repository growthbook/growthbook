import { useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { MetricOverride } from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
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

export interface UseExperimentTableRowsOptions {
  // Core experiment data
  results: ExperimentReportResultDimension;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  
  // Analysis settings
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  pValueThreshold?: number;
  differenceType: DifferenceType;
  
  // Feature flags and permissions
  isMetricSlicesFeatureEnabled?: boolean;
  hasMetricSlicesFeature?: boolean;
  
  // Slice-related options
  pinnedMetricSlices?: string[];
  expandedMetrics?: Record<string, boolean>;
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  
  // Sorting and filtering
  sortBy?: "metric-tags" | "significance" | "change" | null;
  sortDirection?: "asc" | "desc" | null;
  metricFilter?: ResultsMetricFilters;
  analysisBarSettings?: {
    variationFilter: number[];
  };
  variationFilter?: number[];
  
  // SSR support
  ssrPolyfills?: SSRPolyfills;
}

export interface UseExperimentTableRowsReturn {
  rows: ExperimentTableRow[];
  expandedMetrics: Record<string, boolean>;
  toggleExpandedMetric: (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  getChildRowCounts: (metricId: string) => { total: number; pinned: number };
  allMetricTags: string[];
  expandedGoals: string[];
  expandedSecondaries: string[];
  expandedGuardrails: string[];
}

export function useExperimentTableRows(
  options: UseExperimentTableRowsOptions,
): UseExperimentTableRowsReturn {
  const {
    results,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides,
    settingsForSnapshotMetrics,
    statsEngine,
    pValueCorrection,
    pValueThreshold: providedPValueThreshold,
    differenceType: _differenceType,
    isMetricSlicesFeatureEnabled: providedIsMetricSlicesFeatureEnabled,
    hasMetricSlicesFeature: providedHasMetricSlicesFeature,
    pinnedMetricSlices,
    expandedMetrics: providedExpandedMetrics,
    customMetricSlices,
    sortBy,
    sortDirection,
    metricFilter,
    analysisBarSettings,
    variationFilter,
    ssrPolyfills,
  } = options;

  const { getExperimentMetricById, getFactTableById, metricGroups } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();
  const growthbook = useGrowthBook<AppFeatures>();
  const { metricDefaults } = useOrganizationMetricDefaults();

  // Feature flag and commercial feature checks for slice analysis
  const isMetricSlicesFeatureEnabled =
    providedIsMetricSlicesFeatureEnabled ?? growthbook?.isOn("metric-slices");
  const hasMetricSlicesFeature =
    providedHasMetricSlicesFeature ?? hasCommercialFeature("metric-slices");
  const shouldShowMetricSlices =
    isMetricSlicesFeatureEnabled && hasMetricSlicesFeature;

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() ||
    providedPValueThreshold ||
    _pValueThreshold;

  // State management for expanded metrics
  const [expandedMetrics, setExpandedMetrics] = useState<
    Record<string, boolean>
  >(providedExpandedMetrics || {});
  const toggleExpandedMetric = (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => {
    const key = `${metricId}:${resultGroup}`;
    setExpandedMetrics((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Expand metric groups for all result groups
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

      if (shouldShowMetricSlices) {
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
            levels: dl.levels,
          }));
          const pinnedKey = generatePinnedSliceKey(
            metricId,
            pinnedSliceLevels,
            resultGroup,
          );
          const isPinned = pinnedMetricSlices?.includes(pinnedKey) || false;

          const shouldShowLevel = isExpanded || isPinned;

          const label = slice.sliceLevels
            .map((dl) => dl.levels[0] || "other")
            .join(" + ");

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

    if (!results || !results.variations) return [];

    // Apply p-value corrections if needed (only for goals)
    if (pValueCorrection && statsEngine === "frequentist") {
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
        variationFilter:
          analysisBarSettings?.variationFilter ?? variationFilter ?? [],
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
    ssrPolyfills,
    getExperimentMetricById,
    getFactTableById,
    metricFilter,
    pinnedMetricSlices,
    expandedMetrics,
    shouldShowMetricSlices,
    customMetricSlices,
    sortBy,
    sortDirection,
    analysisBarSettings?.variationFilter,
    metricDefaults,
    variationFilter,
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
    getChildRowCounts,
    allMetricTags,
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
  };
}
