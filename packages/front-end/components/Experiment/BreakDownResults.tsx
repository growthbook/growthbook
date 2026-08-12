import { FC, Fragment, useState } from "react";
import { IconButton } from "@radix-ui/themes";
import { PiCaretCircleRight, PiCaretCircleDown } from "react-icons/pi";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "shared/types/report";
import {
  ExperimentStatus,
  ExperimentType,
  MetricOverride,
} from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  DifferenceType,
  PValueCorrection,
  SignificanceThresholds,
  StatsEngine,
} from "shared/types/stats";
import {
  ExperimentMetricDefinition,
  ExperimentSortBy,
  SetExperimentSortBy,
  formatDimensionValueForDisplay,
} from "shared/experiments";
import { NULL_DIMENSION_VALUE } from "shared/constants";
import { FaCaretRight } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ExperimentTableRow } from "@/services/experiments";
import ResultsTable, {
  RESULTS_TABLE_COLUMNS,
} from "@/components/Experiment/ResultsTable";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import FunnelStepLabel from "@/components/Experiment/FunnelStepLabel";
import RadixTooltip from "@/ui/Tooltip";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useExperimentDimensionRows } from "@/hooks/useExperimentDimensionRows";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useMetricDrilldownContext } from "@/components/MetricDrilldown/useMetricDrilldownContext";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import UsersTable from "./UsersTable";

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
  significanceThresholds: SignificanceThresholds;
  results: ExperimentReportResultDimension[];
  queryStatusData?: QueryStatusData;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  setVariationFilter?: (variationFilter: number[]) => void;
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
  metricTagFilter?: string[];
  metricsFilter?: string[];
  experimentType?: ExperimentType;
  ssrPolyfills?: SSRPolyfills;
  renderMetricName?: (
    metric: ExperimentMetricDefinition,
  ) => React.ReactElement | string;
  noStickyHeader?: boolean;
  sortBy?: ExperimentSortBy;
  setSortBy?: SetExperimentSortBy;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
  customMetricOrder?: string[];
  analysisBarSettings?: {
    variationFilter: number[];
  };
  setBaselineRow?: (baselineRow: number) => void;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  mutate?: () => Promise<unknown>;
  setDifferenceType?: (differenceType: DifferenceType) => void;
}> = ({
  experimentId,
  significanceThresholds,
  dimensionId,
  dimensionValuesFilter,
  results,
  queryStatusData,
  variations,
  variationFilter,
  setVariationFilter,
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
  metricTagFilter,
  metricsFilter,
  experimentType,
  ssrPolyfills,
  renderMetricName,
  noStickyHeader,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  customMetricOrder,
  analysisBarSettings,
  setBaselineRow,
  snapshot,
  analysis,
  setAnalysisSettings,
  mutate,
  setDifferenceType,
}) => {
  const { getDimensionById, getExperimentMetricById } = useDefinitions();

  const _settings = useOrgSettings();
  const settings = ssrPolyfills?.useOrgSettings?.() || _settings;

  // Detect drilldown context for automatic row click handling
  const drilldownContext = useMetricDrilldownContext();

  // Funnel step child rows nest under their dimension-value parent and stay
  // collapsed until the parent's chevron is toggled. The key matches the
  // `parentRowId` (`metricId:dimensionValue`) each child row carries.
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const toggleExpandedRow = (parentRowId: string) => {
    setExpandedRows((prev) => ({ ...prev, [parentRowId]: !prev[parentRowId] }));
  };

  const dimension =
    ssrPolyfills?.getDimensionById?.(dimensionId)?.name ||
    getDimensionById(dimensionId)?.name ||
    dimensionId?.split(":")?.[1] ||
    "Dimension";

  const { tables } = useExperimentDimensionRows({
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
    showErrorsOnQuantileMetrics,
    pValueThreshold: significanceThresholds.pValueThreshold,
  });

  const activationMetricObj = activationMetric
    ? ssrPolyfills?.getExperimentMetricById?.(activationMetric) ||
      getExperimentMetricById(activationMetric)
    : undefined;

  const isBandit = experimentType === "multi-armed-bandit";
  const isHoldout = experimentType === "holdout";

  // Wrap drilldown to include dimension info
  const handleRowClick = drilldownContext
    ? (row: ExperimentTableRow) => {
        const rawValue = typeof row.label === "string" ? row.label : "";
        const value = formatDimensionValueForDisplay(rawValue);
        drilldownContext.openDrilldown(row, {
          dimensionInfo: { id: dimensionId, name: dimension, value, rawValue },
        });
      }
    : undefined;

  return (
    <div className="mb-3">
      <div className="mb-4">
        {dimensionId === "pre:activation" && activationMetricObj && (
          <Callout status="info" mt="1" mx="3">
            Your experiment has an Activation Metric (
            <strong>{activationMetricObj?.name}</strong>
            ). This report lets you compare activated users with those who
            entered into the experiment, but were not activated.
          </Callout>
        )}
        {!isBandit && (
          <div className="users">
            <Collapsible
              trigger={
                <Link className="d-inline-flex mx-3 align-items-center">
                  <FaCaretRight className="chevron mr-1" />
                  View dimension breakdown
                </Link>
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

      {tables.map((table, i) => {
        // Hide funnel step child rows whose dimension-value parent is collapsed.
        const visibleRows = table.rows.filter(
          (row) =>
            !row.isChildRow ||
            !row.parentRowId ||
            !!expandedRows[row.parentRowId],
        );
        return (
          <Fragment key={table.metric.id + "_" + i}>
            <h4
              className="mt-2 mb-1 d-flex position-relative ml-2"
              style={{ gap: 4 }}
            >
              {table.rows[0]?.resultGroup === "goal"
                ? "Goal Metric"
                : table.rows[0]?.resultGroup === "secondary"
                  ? "Secondary Metric"
                  : table.rows[0]?.resultGroup === "guardrail"
                    ? "Guardrail Metric"
                    : null}
            </h4>
            <ResultsTable
              key={i}
              experimentId={experimentId}
              significanceThresholds={significanceThresholds}
              dateCreated={reportDate}
              isLatestPhase={isLatestPhase}
              phase={phase}
              startDate={startDate}
              endDate={endDate}
              status={status}
              queryStatusData={queryStatusData}
              variations={variations}
              variationFilter={variationFilter}
              setVariationFilter={setVariationFilter}
              baselineRow={baselineRow}
              columnsFilter={columnsFilter}
              rows={visibleRows}
              onRowClick={handleRowClick}
              dimension={dimension}
              id={(idPrefix ? `${idPrefix}_` : "") + table.metric.id}
              tableRowAxis="dimension" // todo: dynamic grouping?
              labelHeader={
                renderMetricName ? (
                  renderMetricName(table.metric)
                ) : (
                  <div style={{ marginBottom: 2 }}>
                    {getRenderLabelColumn({})({
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
              setDifferenceType={setDifferenceType}
              renderLabelColumn={({ label, row }) => {
                if (row?.childRowType === "funnelStep") {
                  return <FunnelStepLabel label={label} row={row} />;
                }

                const hasSteps = !!row?.numChildren;
                const parentRowId = `${row?.metric?.id}:${row?.label ?? ""}`;
                const isExpanded = !!expandedRows[parentRowId];
                return (
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
                    {hasSteps ? (
                      <span
                        style={{
                          position: "absolute",
                          left: 7,
                          top: 0,
                          bottom: 0,
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <RadixTooltip
                          content={
                            isExpanded
                              ? "Collapse funnel steps"
                              : "Expand funnel steps"
                          }
                          side="top"
                        >
                          <IconButton
                            size="1"
                            variant="ghost"
                            radius="full"
                            aria-label={
                              isExpanded
                                ? "Collapse funnel steps"
                                : "Expand funnel steps"
                            }
                            onClick={() => toggleExpandedRow(parentRowId)}
                          >
                            {isExpanded ? (
                              <PiCaretCircleDown size={16} />
                            ) : (
                              <PiCaretCircleRight size={16} />
                            )}
                          </IconButton>
                        </RadixTooltip>
                      </span>
                    ) : null}
                    <span className={hasSteps ? "ml-2" : undefined}>
                      {label ? (
                        label === NULL_DIMENSION_VALUE ? (
                          <em>{formatDimensionValueForDisplay(label)}</em>
                        ) : (
                          label
                        )
                      ) : (
                        <em>unknown</em>
                      )}
                    </span>
                  </div>
                );
              }}
              isTabActive={true}
              isBandit={isBandit}
              ssrPolyfills={ssrPolyfills}
              noStickyHeader={noStickyHeader}
              isHoldout={isHoldout}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
              setBaselineRow={setBaselineRow}
              snapshot={snapshot}
              analysis={analysis}
              setAnalysisSettings={setAnalysisSettings}
              mutate={mutate}
            />
            <div className="mb-5" />
          </Fragment>
        );
      })}
    </div>
  );
};
export default BreakDownResults;
