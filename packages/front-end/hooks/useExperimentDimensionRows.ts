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
  ExperimentSortBy,
  quantileMetricType,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
  isMetricGroupId,
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
  sortMetricsByCustomOrder,
  sortMetricsByTags,
} from "./useExperimentTableRows";

export interface UseExperimentDimensionRowsParams {
  results: ExperimentReportResultDimension[];
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  ssrPolyfills?: SSRPolyfills;
  metricTagFilter?: string[];
  metricsFilter?: string[];
  sortBy?: ExperimentSortBy;
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
}

export function useExperimentDimensionRows({
  results,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricOverrides,
  ssrPolyfills,
  metricTagFilter,
  metricsFilter,
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
      const allMetricGroups = ssrPolyfills?.metricGroups || metricGroups;

      // Check for selector IDs in metricsFilter (they constrain which categories to show)
      const hasGoalSelector =
        metricsFilter?.includes("experiment-goal") ?? false;
      const hasSecondarySelector =
        metricsFilter?.includes("experiment-secondary") ?? false;
      const hasGuardrailSelector =
        metricsFilter?.includes("experiment-guardrail") ?? false;

      // Filter out selector IDs from the actual metric filter
      const actualMetricFilter =
        metricsFilter?.filter(
          (id) =>
            ![
              "experiment-goal",
              "experiment-secondary",
              "experiment-guardrail",
            ].includes(id),
        ) ?? [];

      // Determine which categories to include based on selector IDs
      // If no selectors are present, include all categories (equivalent to "all")
      const includeGoals =
        hasGoalSelector ||
        (!hasGoalSelector && !hasSecondarySelector && !hasGuardrailSelector);
      const includeSecondaries =
        hasSecondarySelector ||
        (!hasGoalSelector && !hasSecondarySelector && !hasGuardrailSelector);
      const includeGuardrails =
        hasGuardrailSelector ||
        (!hasGoalSelector && !hasSecondarySelector && !hasGuardrailSelector);

      // Filter by metric groups if filter is active
      let filteredGoalMetrics: string[] = [];
      let filteredSecondaryMetrics: string[] = [];
      let filteredGuardrailMetrics: string[] = [];

      if (
        actualMetricFilter.length > 0 ||
        hasGoalSelector ||
        hasSecondarySelector ||
        hasGuardrailSelector
      ) {
        // Create a set of allowed metric IDs from expanded groups and individual metrics
        const allowedMetricIds = new Set<string>();
        actualMetricFilter.forEach((id) => {
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
        // Only include categories that are selected via selector IDs
        // For groups, expand them first and check if any expanded metric matches
        if (includeGoals) {
          filteredGoalMetrics = goalMetrics.filter((id) => {
            // If no actual metric filter, include all goal metrics (selector-only case)
            if (actualMetricFilter.length === 0) return true;
            // Otherwise, filter by actual metric filter (within goal category)
            if (actualMetricFilter.includes(id)) return true;
            if (allowedMetricIds.has(id)) return true;
            // If it's a group, expand it and check if any metric matches
            if (isMetricGroupId(id)) {
              const group = allMetricGroups.find((g) => g.id === id);
              if (group) {
                return group.metrics.some((metricId) =>
                  allowedMetricIds.has(metricId),
                );
              }
            }
            return false;
          });
        }

        if (includeSecondaries) {
          filteredSecondaryMetrics = secondaryMetrics.filter((id) => {
            // If no actual metric filter, include all secondary metrics (selector-only case)
            if (actualMetricFilter.length === 0) return true;
            // Otherwise, filter by actual metric filter (within secondary category)
            if (actualMetricFilter.includes(id)) return true;
            if (allowedMetricIds.has(id)) return true;
            // If it's a group, expand it and check if any metric matches
            if (isMetricGroupId(id)) {
              const group = allMetricGroups.find((g) => g.id === id);
              if (group) {
                return group.metrics.some((metricId) =>
                  allowedMetricIds.has(metricId),
                );
              }
            }
            return false;
          });
        }

        if (includeGuardrails) {
          filteredGuardrailMetrics = guardrailMetrics.filter((id) => {
            // If no actual metric filter, include all guardrail metrics (selector-only case)
            if (actualMetricFilter.length === 0) return true;
            // Otherwise, filter by actual metric filter (within guardrail category)
            if (actualMetricFilter.includes(id)) return true;
            if (allowedMetricIds.has(id)) return true;
            // If it's a group, expand it and check if any metric matches
            if (isMetricGroupId(id)) {
              const group = allMetricGroups.find((g) => g.id === id);
              if (group) {
                return group.metrics.some((metricId) =>
                  allowedMetricIds.has(metricId),
                );
              }
            }
            return false;
          });
        }
      } else {
        // No filter at all - include all metrics
        filteredGoalMetrics = goalMetrics;
        filteredSecondaryMetrics = secondaryMetrics;
        filteredGuardrailMetrics = guardrailMetrics;
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

      // Dedupe metric rows to prevent rendering the same metric multiple times
      const dedupedGoals: string[] = [];
      expandedGoals.forEach((metricId) => {
        if (!dedupedGoals.includes(metricId)) {
          dedupedGoals.push(metricId);
        }
      });
      const dedupedSecondaries: string[] = [];
      expandedSecondaries.forEach((metricId) => {
        if (!dedupedSecondaries.includes(metricId)) {
          dedupedSecondaries.push(metricId);
        }
      });
      const dedupedGuardrails: string[] = [];
      expandedGuardrails.forEach((metricId) => {
        if (!dedupedGuardrails.includes(metricId)) {
          dedupedGuardrails.push(metricId);
        }
      });

      return {
        expandedGoals: dedupedGoals,
        expandedSecondaries: dedupedSecondaries,
        expandedGuardrails: dedupedGuardrails,
      };
    }, [
      goalMetrics,
      metricGroups,
      ssrPolyfills?.metricGroups,
      secondaryMetrics,
      guardrailMetrics,
      metricsFilter,
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
      // Get metric definitions
      const metricDefs = metricIds
        .map(
          (metricId) =>
            ssrPolyfills?.getExperimentMetricById?.(metricId) ||
            getExperimentMetricById(metricId),
        )
        .filter((m): m is ExperimentMetricInterface => !!m);

      // Apply tag filtering first (independent of sorting)
      const filteredMetricIds = filterMetricsByTags(
        metricDefs,
        metricTagFilter,
      );

      // Apply custom ordering if sortBy is "metrics" or "metricTags"
      const sortedMetricIds =
        sortBy === "metrics" && customMetricOrder
          ? sortMetricsByCustomOrder(
              metricDefs.filter((m) => filteredMetricIds.includes(m.id)),
              customMetricOrder,
              ssrPolyfills?.metricGroups || metricGroups,
            )
          : sortBy === "metricTags" &&
              metricTagFilter &&
              metricTagFilter.length > 0
            ? sortMetricsByTags(
                metricDefs.filter((m) => filteredMetricIds.includes(m.id)),
                metricTagFilter,
                ssrPolyfills?.metricGroups || metricGroups,
              )
            : filteredMetricIds;

      return sortedMetricIds
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
    metricGroups,
    metricOverrides,
    ssrPolyfills,
    metricTagFilter,
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
