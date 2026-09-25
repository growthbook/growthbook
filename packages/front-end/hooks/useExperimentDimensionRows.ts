import { useMemo } from "react";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "shared/types/report";
import { MetricOverride } from "shared/types/experiment";
import { PValueCorrection, StatsEngine } from "shared/types/stats";
import {
  expandMetricGroups,
  ExperimentMetricDefinition,
  ExperimentSortBy,
  quantileMetricType,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
  isMetricGroupId,
  isFactFunnelMetric,
  funnelStepMetricId,
  resolveMetricsForSnapshot,
  resolveSnapshotMetricIds,
} from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
  compareRows,
  NO_DATA_ERROR_MESSAGE,
} from "@/services/experiments";
import { RowError } from "@/components/Experiment/ResultsTable";
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
  pValueThreshold: number;
}

export interface UseExperimentDimensionRowsReturn {
  tables: Array<{
    metric: ExperimentMetricDefinition;
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
  pValueThreshold,
}: UseExperimentDimensionRowsParams): UseExperimentDimensionRowsReturn {
  const { getExperimentMetricById, metricGroups, ready } = useDefinitions();
  const { metricDefaults } = useOrganizationMetricDefaults();

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

      const allowedMetricIds = new Set<string>();
      actualMetricFilter.forEach((id) => {
        if (isMetricGroupId(id)) {
          const group = allMetricGroups.find((g) => g.id === id);
          if (group) {
            group.metrics.forEach((metricId) => allowedMetricIds.add(metricId));
          }
        } else {
          allowedMetricIds.add(id);
        }
      });

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

      // allowedMetricIds is the set of metrics that are explicitly selected
      // by the user either directly or via the group. This code will drop
      // metrics in groups that are not explicitly selected via the group or
      // themselves.
      const finalExpandedGoals =
        actualMetricFilter.length > 0
          ? expandedGoals.filter((id) => allowedMetricIds.has(id))
          : expandedGoals;
      const finalExpandedSecondaries =
        actualMetricFilter.length > 0
          ? expandedSecondaries.filter((id) => allowedMetricIds.has(id))
          : expandedSecondaries;
      const finalExpandedGuardrails =
        actualMetricFilter.length > 0
          ? expandedGuardrails.filter((id) => allowedMetricIds.has(id))
          : expandedGuardrails;

      // Dedupe metric rows to prevent rendering the same metric multiple times
      const dedupedGoals: string[] = [];
      finalExpandedGoals.forEach((metricId) => {
        if (!dedupedGoals.includes(metricId)) {
          dedupedGoals.push(metricId);
        }
      });
      const dedupedSecondaries: string[] = [];
      finalExpandedSecondaries.forEach((metricId) => {
        if (!dedupedSecondaries.includes(metricId)) {
          dedupedSecondaries.push(metricId);
        }
      });
      const dedupedGuardrails: string[] = [];
      finalExpandedGuardrails.forEach((metricId) => {
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
    const getMetricById = (id: string) =>
      ssrPolyfills?.getExperimentMetricById?.(id) ||
      getExperimentMetricById(id);

    if (!results.length || (!ready && !ssrPolyfills)) {
      return [];
    }

    if (pValueCorrection && statsEngine === "frequentist") {
      setAdjustedPValuesOnResults(
        results,
        resolveSnapshotMetricIds({
          metricIds: expandedGoals,
          getExperimentMetricById: getMetricById,
          results,
        }),
        pValueCorrection,
      );
      setAdjustedCIs(results, pValueThreshold);
    }

    // Helper function to process metrics by type
    function processMetricsByType(
      metricIds: string[],
      resultGroup: "goal" | "secondary" | "guardrail",
    ) {
      // Get metric definitions
      const metricDefs = metricIds
        .map(getMetricById)
        .filter((m): m is ExperimentMetricDefinition => !!m);

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

      const buildTable = (
        metric: ExperimentMetricDefinition,
        replacedByMetricName: string | undefined,
      ) => {
        const { newMetric, overrideFields } = applyMetricOverrides(
          metric,
          metricOverrides,
        );
        const metricSnapshotSettings = settingsForSnapshotMetrics?.find(
          (s) => s.metric === metric.id,
        );

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
                metricSnapshotSettings,
                resultGroup,
                metricOverrideFields: overrideFields,
                error: RowError.QUANTILE_AGGREGATION_ERROR,
                replacedByMetricName,
              },
            ],
          };
        }

        return {
          metric: newMetric,
          isGuardrail: resultGroup === "guardrail",
          rows: generateDimensionRowsForMetric({
            metricId: metric.id,
            resultGroup,
            results,
            dimensionValuesFilter,
            overrideFields,
            metricSnapshotSettings,
            newMetric,
            replacedByMetricName,
          }),
        };
      };

      const seenMetricIds = new Set<string>();
      return sortedMetricIds
        .flatMap((metricId) => {
          const experimentMetric = getMetricById(metricId);
          if (!experimentMetric) return [];
          const { metrics, replacedByMetricName } = resolveMetricsForSnapshot({
            metric: experimentMetric,
            getExperimentMetricById: getMetricById,
            results,
          });
          return metrics.map((metric) =>
            buildTable(metric, replacedByMetricName),
          );
        })
        .filter(
          (table) =>
            !seenMetricIds.has(table.metric.id) &&
            !!seenMetricIds.add(table.metric.id),
        );
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

      // A funnel table's rows are dimension-value parents with per-step child
      // rows beneath each. Sort the parents but keep each parent's steps
      // attached in step order; a flat sort would tear that grouping apart.
      return tables.map((table) =>
        isFactFunnelMetric(table.metric)
          ? {
              ...table,
              rows: sortFunnelDimensionRows(table.rows, sortOptions),
            }
          : {
              ...table,
              rows: [...table.rows].sort((a, b) =>
                compareRows(a, b, sortOptions),
              ),
            },
      );
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
  replacedByMetricName,
}: {
  metricId: string;
  resultGroup: "goal" | "secondary" | "guardrail";
  results: ExperimentReportResultDimension[];
  dimensionValuesFilter?: string[];
  overrideFields: string[];
  metricSnapshotSettings: MetricSnapshotSettings | undefined;
  newMetric: ExperimentMetricDefinition;
  replacedByMetricName?: string;
}): ExperimentTableRow[] {
  const filteredResults = includeVariation(results, dimensionValuesFilter);

  const funnelSteps = isFactFunnelMetric(newMetric)
    ? newMetric.funnelSettings.steps
    : [];

  const noData = () => ({
    users: 0,
    value: 0,
    cr: 0,
    errorMessage: NO_DATA_ERROR_MESSAGE,
  });

  const rows: ExperimentTableRow[] = [];

  // One row per dimension result. For a funnel metric the dimension value is
  // the parent (whole-funnel completion) and each step follows as a child row,
  // mirroring the overall table's nesting one level deeper.
  filteredResults.forEach((dimensionResult) => {
    const parentRow: ExperimentTableRow = {
      label: dimensionResult.name,
      dimensionValue: dimensionResult.name,
      metric: newMetric,
      metricOverrideFields: overrideFields,
      rowClass: newMetric?.inverse ? "inverse" : "",
      variations: dimensionResult.variations.map(
        (v) => v.metrics?.[metricId] || noData(),
      ),
      metricSnapshotSettings,
      resultGroup,
      replacedByMetricName,
    };

    if (!funnelSteps.length) {
      rows.push(parentRow);
      return;
    }

    const parentRowId = `${metricId}:${dimensionResult.name}`;
    parentRow.numChildren = funnelSteps.length;
    rows.push(parentRow);

    funnelSteps.forEach((step, stepIndex) => {
      const stepMetricId = funnelStepMetricId(metricId, stepIndex);
      rows.push({
        label: step.name,
        dimensionValue: dimensionResult.name,
        metric: newMetric,
        metricOverrideFields: overrideFields,
        rowClass: newMetric?.inverse ? "inverse" : "",
        variations: dimensionResult.variations.map(
          (v) => v.metrics?.[stepMetricId] || noData(),
        ),
        metricSnapshotSettings,
        resultGroup,
        replacedByMetricName,
        numChildren: 0,
        isChildRow: true,
        childRowType: "funnelStep",
        funnelStepIndex: stepIndex,
        funnelStepOptional: step.optional,
        parentRowId,
        isHiddenByFilter: false,
      });
    });
  });

  return rows;
}

export interface FunnelDimensionRowGroup {
  parent: ExperimentTableRow;
  children: ExperimentTableRow[];
}

// A funnel dimension table is a flat list of dimension-value parent rows, each
// followed by its step child rows. Group them so a parent can move without
// detaching its steps.
export function groupFunnelDimensionRows(
  rows: ExperimentTableRow[],
): FunnelDimensionRowGroup[] {
  const groups: FunnelDimensionRowGroup[] = [];
  for (const row of rows) {
    if (row.isChildRow && groups.length > 0) {
      groups[groups.length - 1].children.push(row);
    } else {
      groups.push({ parent: row, children: [] });
    }
  }
  return groups;
}

// Sort the parent dimension rows by significance/change while keeping each
// parent's step children beneath it in their original step order.
export function sortFunnelDimensionRows(
  rows: ExperimentTableRow[],
  sortOptions: Parameters<typeof compareRows>[2],
): ExperimentTableRow[] {
  return groupFunnelDimensionRows(rows)
    .sort((a, b) => compareRows(a.parent, b.parent, sortOptions))
    .flatMap((group) => [group.parent, ...group.children]);
}
