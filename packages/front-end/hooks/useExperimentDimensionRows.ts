import { useMemo } from "react";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { MetricOverride } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  quantileMetricType,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
  compareRows,
} from "@/services/experiments";
import { RowError } from "@/components/Experiment/ResultsTable";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import {
  filterMetricsByTags,
  getAllMetricTags,
} from "./useExperimentTableRows";

export interface UseExperimentDimensionRowsParams {
  results: ExperimentReportResultDimension[];
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  ssrPolyfills?: SSRPolyfills;
  metricTagFilter?: string[];
  metricGroupsFilter?: string[];
  sortBy?: "significance" | "change" | "custom" | null;
  sortDirection?: "asc" | "desc" | null;
  customMetricOrder?: string[];
  analysisBarSettings?: {
    variationFilter: number[];
  };
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  dimensionValuesFilter?: string[];
  showErrorsOnQuantileMetrics?: boolean;
}

export interface UseExperimentDimensionRowsReturn {
  tables: Array<{
    metric: ExperimentMetricInterface;
    isGuardrail: boolean;
    rows: ExperimentTableRow[];
  }>;
  allMetricTags: string[];
}

export function useExperimentDimensionRows({
  results,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricOverrides,
  ssrPolyfills,
  metricTagFilter,
  metricGroupsFilter,
  sortBy,
  sortDirection,
  customMetricOrder: _customMetricOrder,
  analysisBarSettings,
  statsEngine,
  pValueCorrection,
  settingsForSnapshotMetrics,
  dimensionValuesFilter,
  showErrorsOnQuantileMetrics = false,
}: UseExperimentDimensionRowsParams): UseExperimentDimensionRowsReturn {
  const { getExperimentMetricById, metricGroups, ready } = useDefinitions();
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

      if (metricGroupsFilter && metricGroupsFilter.length > 0) {
        // Create a set of all metric IDs that belong to the selected groups
        const allowedMetricIds = new Set<string>();
        metricGroupsFilter.forEach((groupId) => {
          const group = allMetricGroups.find((g) => g.id === groupId);
          if (group) {
            group.metrics.forEach((metricId) => allowedMetricIds.add(metricId));
          }
        });

        // Filter metrics: only include group IDs that are selected, or individual metrics that are in selected groups
        filteredGoalMetrics = goalMetrics.filter((id) => {
          if (metricGroupsFilter.includes(id)) return true; // Selected group
          if (!allowedMetricIds.has(id)) return false; // Not in any selected group
          return true; // Individual metric in a selected group
        });
        filteredSecondaryMetrics = secondaryMetrics.filter((id) => {
          if (metricGroupsFilter.includes(id)) return true;
          if (!allowedMetricIds.has(id)) return false;
          return true;
        });
        filteredGuardrailMetrics = guardrailMetrics.filter((id) => {
          if (metricGroupsFilter.includes(id)) return true;
          if (!allowedMetricIds.has(id)) return false;
          return true;
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
      metricGroupsFilter,
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

  const tables = useMemo(() => {
    if (!results.length || (!ready && !ssrPolyfills)) {
      return [];
    }

    if (pValueCorrection && statsEngine === "frequentist") {
      setAdjustedPValuesOnResults(results, expandedGoals, pValueCorrection);
      setAdjustedCIs(results, pValueThreshold);
    }

    // Helper function to process metrics by type
    function processMetricsByType(
      metricIds: string[],
      resultGroup: "goal" | "secondary" | "guardrail",
    ) {
      return metricIds
        .map((metricId) => {
          const metric =
            ssrPolyfills?.getExperimentMetricById?.(metricId) ||
            getExperimentMetricById(metricId);
          if (!metric) return null;

          // Apply filtering first (independent of sorting)
          const filteredMetrics = filterMetricsByTags(
            [metric],
            metricTagFilter,
          );
          if (filteredMetrics.length === 0) return null;

          const { newMetric, overrideFields } = applyMetricOverrides(
            metric,
            metricOverrides,
          );
          let _metricSnapshotSettings: MetricSnapshotSettings | undefined;
          if (settingsForSnapshotMetrics) {
            _metricSnapshotSettings = settingsForSnapshotMetrics.find(
              (s) => s.metric === metricId,
            );
          }

          // Handle quantile metric errors
          if (showErrorsOnQuantileMetrics && quantileMetricType(newMetric)) {
            return {
              metric: newMetric,
              isGuardrail: resultGroup === "guardrail",
              rows: [
                {
                  label: "",
                  metric: newMetric,
                  variations: [],
                  metricSnapshotSettings: _metricSnapshotSettings,
                  resultGroup,
                  metricOverrideFields: overrideFields,
                  error: RowError.QUANTILE_AGGREGATION_ERROR,
                },
              ],
            };
          }

          const rows = generateDimensionRowsForMetric({
            metricId,
            resultGroup,
            results,
            dimensionValuesFilter,
            overrideFields,
            metricSnapshotSettings: _metricSnapshotSettings,
            newMetric,
          });

          return {
            metric: newMetric,
            isGuardrail: resultGroup === "guardrail",
            rows,
          };
        })
        .filter((table) => table?.metric) as Array<{
        metric: ExperimentMetricInterface;
        isGuardrail: boolean;
        rows: ExperimentTableRow[];
      }>;
    }

    const tables = [
      ...processMetricsByType(expandedGoals, "goal"),
      ...processMetricsByType(expandedSecondaries, "secondary"),
      ...processMetricsByType(expandedGuardrails, "guardrail"),
    ];

    // Sort rows within each table by significance or change if sortBy is set
    if (sortBy === "significance" || sortBy === "change") {
      const sortOptions = {
        sortBy,
        variationFilter: analysisBarSettings?.variationFilter ?? [],
        metricDefaults,
        sortDirection: sortDirection || "desc",
      };

      return tables.map((table) => ({
        ...table,
        rows: [...table.rows].sort((a, b) => compareRows(a, b, sortOptions)),
      }));
    }

    return tables;
  }, [
    results,
    metricOverrides,
    ssrPolyfills,
    metricTagFilter,
    sortBy,
    sortDirection,
    analysisBarSettings,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    dimensionValuesFilter,
    getExperimentMetricById,
    ready,
    metricDefaults,
    pValueThreshold,
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    showErrorsOnQuantileMetrics,
  ]);

  return {
    tables,
    allMetricTags,
  };
}

// Helper function to determine metric result group
export function getMetricResultGroup(
  metricId: string,
  goalMetrics: string[],
  secondaryMetrics: string[],
): "goal" | "secondary" | "guardrail" {
  return goalMetrics.includes(metricId)
    ? "goal"
    : secondaryMetrics.includes(metricId)
      ? "secondary"
      : "guardrail";
}

// Helper function to filter dimension results
function includeVariation(
  dimensionResults: ExperimentReportResultDimension[],
  dimensionValuesFilter?: string[],
): ExperimentReportResultDimension[] {
  if (!dimensionValuesFilter || dimensionValuesFilter.length === 0) {
    return dimensionResults;
  }
  return dimensionResults.filter((d) => dimensionValuesFilter.includes(d.name));
}

// Specialized row generation for dimension mode - creates one row per dimension result
export function generateDimensionRowsForMetric({
  metricId,
  resultGroup,
  results,
  dimensionValuesFilter,
  overrideFields,
  metricSnapshotSettings,
  newMetric,
}: {
  metricId: string;
  resultGroup: "goal" | "secondary" | "guardrail";
  results: ExperimentReportResultDimension[];
  dimensionValuesFilter?: string[];
  overrideFields: string[];
  metricSnapshotSettings: MetricSnapshotSettings | undefined;
  newMetric: ExperimentMetricInterface;
}): ExperimentTableRow[] {
  const filteredResults = includeVariation(results, dimensionValuesFilter);

  const rows: ExperimentTableRow[] = [];

  // Create a row for each dimension result
  filteredResults.forEach((dimensionResult) => {
    const row: ExperimentTableRow = {
      label: dimensionResult.name,
      metric: newMetric,
      metricOverrideFields: overrideFields,
      rowClass: newMetric?.inverse ? "inverse" : "",
      variations: dimensionResult.variations.map((v) => {
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
    };

    rows.push(row);
  });

  return rows;
}
