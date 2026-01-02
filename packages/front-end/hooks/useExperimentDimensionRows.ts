import { useMemo } from "react";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "shared/types/report";
import { MetricOverride } from "shared/types/experiment";
import { PValueCorrection, StatsEngine } from "shared/types/stats";
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
import {
  ResultsMetricFilters,
  sortAndFilterMetricsByTags,
} from "@/components/Experiment/Results";
import { RowError } from "@/components/Experiment/ResultsTable";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { getAllMetricTags } from "./useExperimentTableRows";

export interface UseExperimentDimensionRowsParams {
  results: ExperimentReportResultDimension[];
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  ssrPolyfills?: SSRPolyfills;
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
  metricFilter,
  sortBy,
  sortDirection,
  customMetricOrder,
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

          const ret =
            sortBy === "metric-tags"
              ? sortAndFilterMetricsByTags([metric], metricFilter)
              : sortBy === "custom" && customMetricOrder
                ? sortMetricsByCustomOrder([metric], customMetricOrder)
                : [metric.id];
          if (ret.length === 0) return null;

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
    metricFilter,
    sortBy,
    sortDirection,
    customMetricOrder,
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

function sortMetricsByCustomOrder(
  metrics: ExperimentMetricInterface[],
  customOrder: string[],
): string[] {
  const metricIds = metrics.map((m) => m.id);
  const orderedMetrics = customOrder.filter((id) => metricIds.includes(id));
  const unorderedMetrics = metricIds.filter((id) => !customOrder.includes(id));
  return [...orderedMetrics, ...unorderedMetrics];
}
