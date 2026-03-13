import { FC, useState, ReactElement } from "react";
import { IconButton } from "@radix-ui/themes";
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
  StatsEngine,
} from "shared/types/stats";
import {
  ExperimentMetricInterface,
  ExperimentSortBy,
  SetExperimentSortBy,
  formatDimensionValueForDisplay,
} from "shared/experiments";
import { NULL_DIMENSION_VALUE } from "shared/constants";
import { FaCaretRight } from "react-icons/fa";
import { PiCaretCircleRight, PiCaretCircleDown } from "react-icons/pi";
import Collapsible from "react-collapsible";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ExperimentTableRow } from "@/services/experiments";
import ResultsTable, {
  RESULTS_TABLE_COLUMNS,
} from "@/components/Experiment/ResultsTable";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useExperimentDimensionRows } from "@/hooks/useExperimentDimensionRows";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useMetricDrilldownContext } from "@/components/MetricDrilldown/useMetricDrilldownContext";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
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
  sliceTagsFilter?: string[];
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  experimentType?: ExperimentType;
  ssrPolyfills?: SSRPolyfills;
  renderMetricName?: (
    metric: ExperimentMetricInterface,
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
  sliceTagsFilter,
  customMetricSlices,
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

  const dimension =
    ssrPolyfills?.getDimensionById?.(dimensionId)?.name ||
    getDimensionById(dimensionId)?.name ||
    dimensionId?.split(":")?.[1] ||
    "Dimension";

  // Expanded state for dimension value rows (to show slices underneath)
  const [expandedDimensionRows, setExpandedDimensionRows] = useState<
    Record<string, boolean>
  >({});
  const toggleExpandedDimensionRow = (
    metricId: string,
    dimensionValue: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => {
    const key = `${metricId}:${dimensionValue}:${resultGroup}`;
    setExpandedDimensionRows((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const { tables, getSliceCountForDimensionRow } = useExperimentDimensionRows({
    results,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides,
    ssrPolyfills,
    metricTagFilter,
    metricsFilter,
    sliceTagsFilter,
    customMetricSlices,
    sortBy,
    sortDirection,
    customMetricOrder,
    analysisBarSettings,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    dimensionValuesFilter,
    showErrorsOnQuantileMetrics,
    shouldShowMetricSlices: true,
    expandedDimensionRows,
  });

  const activationMetricObj = activationMetric
    ? ssrPolyfills?.getExperimentMetricById?.(activationMetric) ||
      getExperimentMetricById(activationMetric)
    : undefined;

  const isBandit = experimentType === "multi-armed-bandit";
  const isHoldout = experimentType === "holdout";

  // Filter slice rows based on expansion state when there's no slice filter
  const hasSliceFilter = sliceTagsFilter && sliceTagsFilter.length > 0;

  // Wrap drilldown to include dimension info
  const handleRowClick = drilldownContext
    ? (row: ExperimentTableRow) => {
        const value =
          typeof row.label === "string"
            ? formatDimensionValueForDisplay(row.label)
            : "";
        drilldownContext.openDrilldown(row, {
          dimensionInfo: { name: dimension, value },
        });
      }
    : undefined;

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
        // Filter out hidden slice rows
        const visibleRows = table.rows.filter((row) => !row.isHiddenByFilter);

        return (
          <>
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
              tableRowAxis="dimension"
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
              renderLabelColumn={renderDimensionLabelColumn({
                hasSliceFilter: hasSliceFilter ?? false,
                sliceTagsFilter,
                expandedDimensionRows,
                toggleExpandedDimensionRow,
                getSliceCountForDimensionRow,
              })}
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
          </>
        );
      })}
    </div>
  );
};
export default BreakDownResults;

// Helper function to render dimension value labels with expand/collapse for slices
function renderDimensionLabelColumn({
  hasSliceFilter,
  sliceTagsFilter: _sliceTagsFilter,
  expandedDimensionRows,
  toggleExpandedDimensionRow,
  getSliceCountForDimensionRow: _getSliceCountForDimensionRow,
}: {
  hasSliceFilter: boolean;
  sliceTagsFilter?: string[];
  expandedDimensionRows: Record<string, boolean>;
  toggleExpandedDimensionRow: (
    metricId: string,
    dimensionValue: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  getSliceCountForDimensionRow: (
    metricId: string,
    dimensionValue: string,
  ) => number;
}) {
  return function renderLabelColumn({
    label,
    row,
  }: {
    label: string | ReactElement;
    row?: ExperimentTableRow;
  }) {
    // For slice rows, use the slice row rendering from getRenderLabelColumn
    if (row?.isSliceRow) {
      return getRenderLabelColumn({})({
        label: label as string,
        metric: row.metric,
        row,
      });
    }

    // For dimension value rows, show expand/collapse if there are slices
    const dimensionValue = row?.dimensionValue || (label as string);
    const metricId = row?.metric?.id || "";
    const resultGroup = row?.resultGroup || "goal";
    const expandedKey = `${metricId}:${dimensionValue}:${resultGroup}`;
    const isExpanded = !!expandedDimensionRows?.[expandedKey];

    const numSlices = row?.numSlices || 0;
    const hasSlices = numSlices > 0;
    const shouldShowExpandButton =
      hasSlices && !row?.labelOnly && !hasSliceFilter;

    return (
      <div className="pl-3" style={{ position: "relative" }}>
        {shouldShowExpandButton && (
          <div style={{ position: "absolute", left: 7, marginTop: 3 }}>
            <Tooltip
              body={
                isExpanded ? "Collapse metric slices" : "Expand metric slices"
              }
              tipPosition="top"
            >
              <IconButton
                size="1"
                variant="ghost"
                radius="full"
                onClick={() =>
                  toggleExpandedDimensionRow(
                    metricId,
                    dimensionValue,
                    resultGroup,
                  )
                }
              >
                {isExpanded ? (
                  <PiCaretCircleDown size={16} />
                ) : (
                  <PiCaretCircleRight size={16} />
                )}
              </IconButton>
            </Tooltip>
          </div>
        )}
        <span
          className="ml-2 font-weight-bold"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            color: "var(--color-text-mid)",
          }}
        >
          {label ? (
            label === NULL_DIMENSION_VALUE ? (
              <em>{formatDimensionValueForDisplay(label as string)}</em>
            ) : (
              label
            )
          ) : (
            <em>unknown</em>
          )}
        </span>
      </div>
    );
  };
}
