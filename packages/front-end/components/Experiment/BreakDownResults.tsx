import { FC, useState } from "react";
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
import { ExperimentMetricInterface } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import ResultsTable, {
  RESULTS_TABLE_COLUMNS,
} from "@/components/Experiment/ResultsTable";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import { ResultsMetricFilters } from "@/components/Experiment/Results";
import ResultsMetricFilter from "@/components/Experiment/ResultsMetricFilter";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useExperimentDimensionRows } from "@/hooks/useExperimentDimensionRows";

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
  sortBy?: "metric-tags" | "significance" | "change" | "custom" | null;
  setSortBy?: (
    s: "metric-tags" | "significance" | "change" | "custom" | null,
  ) => void;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
  customMetricOrder?: string[];
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
  customMetricOrder,
  analysisBarSettings,
}) => {
  const [showMetricFilter, setShowMetricFilter] = useState<boolean>(false);

  const { getDimensionById, getExperimentMetricById } = useDefinitions();

  const dimension =
    ssrPolyfills?.getDimensionById?.(dimensionId)?.name ||
    getDimensionById(dimensionId)?.name ||
    dimensionId?.split(":")?.[1] ||
    "Dimension";

  const { tables, allMetricTags } = useExperimentDimensionRows({
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
    showErrorsOnQuantileMetrics,
  });

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
        return (
          <>
            <h5 className="ml-2 mt-2 position-relative">
              {table.rows[0]?.resultGroup === "goal"
                ? "Goal Metric"
                : table.rows[0]?.resultGroup === "secondary"
                  ? "Secondary Metric"
                  : table.rows[0]?.resultGroup === "guardrail"
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
