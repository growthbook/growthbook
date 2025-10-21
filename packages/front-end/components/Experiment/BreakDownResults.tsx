import { FC, useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "back-end/types/report";
import {
  ExperimentStatus,
  ExperimentType,
  MetricOverride,
} from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  quantileMetricType,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { FaAngleRight, FaUsers } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
  compareRows,
} from "@/services/experiments";
import ResultsTable, {
  RESULTS_TABLE_COLUMNS,
  RowError,
} from "@/components/Experiment/ResultsTable";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import {
  ResultsMetricFilters,
  sortAndFilterMetricsByTags,
} from "@/components/Experiment/Results";
import ResultsMetricFilter from "@/components/Experiment/ResultsMetricFilter";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import UsersTable from "./UsersTable";

const numberFormatter = Intl.NumberFormat();
export const includeVariation = (
  d: ExperimentReportResultDimension,
  dimensionValuesFilter?: string[],
): boolean => {
  return (
    !dimensionValuesFilter ||
    dimensionValuesFilter.length === 0 ||
    dimensionValuesFilter.includes(d.name)
  );
};

export function getMetricResultGroup(
  metricId,
  goalMetrics: string[],
  secondaryMetrics: string[],
): "goal" | "secondary" | "guardrail" {
  return goalMetrics.includes(metricId)
    ? "goal"
    : secondaryMetrics.includes(metricId)
      ? "secondary"
      : "guardrail";
}

type TableDef = {
  metric: ExperimentMetricInterface;
  isGuardrail: boolean;
  rows: ExperimentTableRow[];
};

const BreakDownResults: FC<{
  experimentId: string;
  results: ExperimentReportResultDimension[];
  queryStatusData?: QueryStatusData;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  columnsFilter?: Array<(typeof RESULTS_TABLE_COLUMNS)[number]>;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  idPrefix?: string;
  dimensionId: string;
  dimensionValuesFilter?: string[];
  isLatestPhase: boolean;
  phase: number;
  startDate: string;
  endDate: string;
  reportDate: Date;
  activationMetric?: string;
  status: ExperimentStatus;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  sequentialTestingEnabled?: boolean;
  showErrorsOnQuantileMetrics?: boolean;
  differenceType: DifferenceType;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (filter: ResultsMetricFilters) => void;
  experimentType?: ExperimentType;
  ssrPolyfills?: SSRPolyfills;
  hideDetails?: boolean;
  renderMetricName?: (
    metric: ExperimentMetricInterface,
  ) => React.ReactElement | string;
  noStickyHeader?: boolean;
  sortBy?: "metric-tags" | "significance" | "change" | null;
  setSortBy?: (s: "metric-tags" | "significance" | "change" | null) => void;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
  analysisBarSettings?: {
    variationFilter: number[];
  };
}> = ({
  experimentId,
  dimensionId,
  dimensionValuesFilter,
  results,
  queryStatusData,
  variations,
  variationFilter,
  baselineRow,
  columnsFilter,
  goalMetrics,
  secondaryMetrics,
  metricOverrides,
  idPrefix,
  guardrailMetrics,
  isLatestPhase,
  phase,
  startDate,
  endDate,
  activationMetric,
  status,
  reportDate,
  statsEngine,
  pValueCorrection,
  settingsForSnapshotMetrics,
  sequentialTestingEnabled,
  showErrorsOnQuantileMetrics,
  differenceType,
  metricFilter,
  setMetricFilter,
  experimentType,
  ssrPolyfills,
  hideDetails,
  renderMetricName,
  noStickyHeader,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  analysisBarSettings,
}) => {
  const [showMetricFilter, setShowMetricFilter] = useState<boolean>(false);

  const { getDimensionById, getExperimentMetricById, metricGroups, ready } =
    useDefinitions();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() || _pValueThreshold;

  const _settings = useOrgSettings();
  const settings = ssrPolyfills?.useOrgSettings?.() || _settings;

  const dimension =
    ssrPolyfills?.getDimensionById?.(dimensionId)?.name ||
    getDimensionById(dimensionId)?.name ||
    dimensionId?.split(":")?.[1] ||
    "Dimension";

  const totalUsers = useMemo(() => {
    let totalUsers = 0;
    results?.forEach((result) => {
      if (includeVariation(result, dimensionValuesFilter)) {
        result?.variations?.forEach((v) => (totalUsers += v?.users || 0));
      }
    });
    return totalUsers;
  }, [results, dimensionValuesFilter]);

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
    [...goalMetrics, ...secondaryMetrics, ...guardrailMetrics].forEach(
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
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    ssrPolyfills,
    getExperimentMetricById,
  ]);

  const tables = useMemo<TableDef[]>(() => {
    if (!ready && !ssrPolyfills) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      // Only include goals in calculation, not secondary or guardrails
      setAdjustedPValuesOnResults(results, expandedGoals, pValueCorrection);
      setAdjustedCIs(results, pValueThreshold);
    }

    const metricDefs = [
      ...expandedGoals,
      ...expandedSecondaries,
      ...expandedGuardrails,
    ]
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

    const tables = Array.from(new Set(sortedFilteredMetrics))
      .map((metricId) => {
        const metric =
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId);
        if (!metric) return;
        // Only filter by tags when sortBy is "metric-tags"
        const ret =
          sortBy === "metric-tags"
            ? sortAndFilterMetricsByTags([metric], metricFilter)
            : [metric.id];
        if (ret.length === 0) return;

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
        const resultGroup = getMetricResultGroup(
          metricId,
          expandedGoals,
          expandedSecondaries,
        );

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
              },
            ],
          };
        }

        const rows: ExperimentTableRow[] = results
          .filter((d) => includeVariation(d, dimensionValuesFilter))
          .map((d) => ({
            label: d.name,
            metric: newMetric,
            variations: d.variations.map((variation) => {
              return variation.metrics[metricId];
            }),
            metricSnapshotSettings,
            resultGroup,
            metricOverrideFields: overrideFields,
          }));
        return {
          metric: newMetric,
          isGuardrail: resultGroup === "guardrail",
          rows: rows,
        };
      })
      .filter((table) => table?.metric) as TableDef[];

    // Sort rows within each table by significance or change if sortBy is set
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
      return tables.map((table) => ({
        ...table,
        rows: [...table.rows].sort((a, b) => compareRows(a, b, sortOptions)),
      }));
    }

    return tables;
  }, [
    results,
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    metricOverrides,
    settingsForSnapshotMetrics,
    pValueCorrection,
    statsEngine,
    pValueThreshold,
    ready,
    ssrPolyfills,
    getExperimentMetricById,
    metricFilter,
    dimensionValuesFilter,
    showErrorsOnQuantileMetrics,
    sortBy,
    sortDirection,
    analysisBarSettings?.variationFilter,
    metricDefaults,
    variationFilter,
  ]);

  const activationMetricObj = activationMetric
    ? ssrPolyfills?.getExperimentMetricById?.(activationMetric) ||
      getExperimentMetricById(activationMetric)
    : undefined;

  const isBandit = experimentType === "multi-armed-bandit";
  const isHoldout = experimentType === "holdout";

  return (
    <div className="mb-3">
      <div className="mb-4">
        {dimensionId === "pre:activation" && activationMetricObj && (
          <div className="alert alert-info mt-1 mx-3">
            Your experiment has an Activation Metric (
            <strong>{activationMetricObj?.name}</strong>
            ). This report lets you compare activated users with those who
            entered into the experiment, but were not activated.
          </div>
        )}
        {!isBandit && (
          <div className="users">
            <Collapsible
              trigger={
                <div className="d-inline-flex mx-3 align-items-center">
                  <FaUsers size={16} className="mr-1" />
                  {numberFormatter.format(totalUsers)} total units
                  <FaAngleRight className="chevron ml-1" />
                </div>
              }
              transitionTime={100}
            >
              <UsersTable
                dimension={dimension}
                dimensionValuesFilter={dimensionValuesFilter}
                results={results}
                variations={variations}
                settings={settings}
              />
            </Collapsible>
          </div>
        )}
      </div>

      <div className="d-flex mx-2">
        {setMetricFilter ? (
          <ResultsMetricFilter
            metricTags={allMetricTags}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            showMetricFilter={showMetricFilter}
            setShowMetricFilter={setShowMetricFilter}
          />
        ) : null}
      </div>
      {tables.map((table, i) => {
        const metric = table.metric;
        return (
          <>
            <h5 className="ml-2 mt-2 position-relative">
              {expandedGoals.includes(metric.id)
                ? "Goal Metric"
                : expandedSecondaries.includes(metric.id)
                  ? "Secondary Metric"
                  : expandedGuardrails.includes(metric.id)
                    ? "Guardrail Metric"
                    : null}
            </h5>
            <ResultsTable
              key={i}
              experimentId={experimentId}
              dateCreated={reportDate}
              isLatestPhase={isLatestPhase}
              phase={phase}
              startDate={startDate}
              endDate={endDate}
              status={status}
              queryStatusData={queryStatusData}
              variations={variations}
              variationFilter={variationFilter}
              baselineRow={baselineRow}
              columnsFilter={columnsFilter}
              rows={table.rows}
              dimension={dimension}
              id={(idPrefix ? `${idPrefix}_` : "") + table.metric.id}
              tableRowAxis="dimension" // todo: dynamic grouping?
              labelHeader={
                renderMetricName ? (
                  renderMetricName(table.metric)
                ) : (
                  <div style={{ marginBottom: 2 }}>
                    {getRenderLabelColumn({
                      statsEngine,
                      hideDetails,
                      experimentType,
                      className: "",
                    })({
                      label: table.metric.name,
                      metric: table.metric,
                      row: table.rows[0],
                    })}
                  </div>
                )
              }
              editMetrics={undefined}
              statsEngine={statsEngine}
              sequentialTestingEnabled={sequentialTestingEnabled}
              pValueCorrection={pValueCorrection}
              differenceType={differenceType}
              renderLabelColumn={({ label }) => (
                <div
                  className="pl-3 font-weight-bold"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 1,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    color: "var(--color-text-mid)",
                  }}
                >
                  {label ? (
                    label === "__NULL_DIMENSION" ? (
                      <em>NULL (unset)</em>
                    ) : (
                      label
                    )
                  ) : (
                    <em>unknown</em>
                  )}
                </div>
              )}
              metricFilter={metricFilter}
              isTabActive={true}
              isBandit={isBandit}
              ssrPolyfills={ssrPolyfills}
              noStickyHeader={noStickyHeader}
              isHoldout={isHoldout}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
            />
            <div className="mb-5" />
          </>
        );
      })}
    </div>
  );
};
export default BreakDownResults;
