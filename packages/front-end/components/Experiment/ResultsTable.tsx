import clsx from "clsx";
import React, {
  CSSProperties,
  ReactElement,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CSSTransition } from "react-transition-group";
import { RxInfoCircled } from "react-icons/rx";
import { FaSortUp, FaSortDown, FaSort } from "react-icons/fa";
import {
  ExperimentReportVariation,
  ExperimentReportVariationWithIndex,
} from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import { useAuth } from "@/services/auth";
import {
  ExperimentTableRow,
  getEffectLabel,
  getRowResults,
  RowResults,
  useDomain,
} from "@/services/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBEdit } from "@/components/Icons";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useCurrency } from "@/hooks/useCurrency";
import PValueColumn from "@/components/Experiment/PValueColumn";
import ChangeColumn from "@/components/Experiment/ChangeColumn";
import ResultsTableTooltip, {
  TooltipHoverSettings,
} from "@/components/Experiment/ResultsTableTooltip/ResultsTableTooltip";
import TimeSeriesButton from "@/components/TimeSeriesButton";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import ResultsMetricFilter from "@/components/Experiment/ResultsMetricFilter";
// No longer need ResultsMetricFilters - we use simple string[] for metricTagFilter
import Tooltip from "@/components/Tooltip/Tooltip";
import { useResultsTableTooltip } from "@/components/Experiment/ResultsTableTooltip/useResultsTableTooltip";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import HelperText from "@/ui/HelperText";
import AlignedGraph from "./AlignedGraph";
import ExperimentMetricTimeSeriesGraphWrapper from "./ExperimentMetricTimeSeriesGraphWrapper";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraph from "./PercentGraph";
import styles from "./ResultsTable.module.scss";

export type ResultsTableProps = {
  id: string;
  experimentId: string;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  status: ExperimentStatus;
  queryStatusData?: QueryStatusData;
  isLatestPhase: boolean;
  phase: number;
  startDate: string;
  endDate: string;
  rows: ExperimentTableRow[];
  dimension?: string;
  tableRowAxis: "metric" | "dimension";
  labelHeader: ReactElement | string;
  editMetrics?: () => void;
  resultGroup?: "goal" | "secondary" | "guardrail";
  renderLabelColumn: ({
    label,
    metric,
    row,
    maxRows,
    location,
  }: {
    label: string | ReactElement;
    metric: ExperimentMetricInterface;
    row: ExperimentTableRow;
    maxRows?: number;
    numDimensions?: number;
    location?: "goal" | "secondary" | "guardrail";
  }) => string | ReactElement;
  dateCreated: Date;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  differenceType: DifferenceType;
  sequentialTestingEnabled?: boolean;
  metricTagFilter?: string[];
  setMetricTagFilter?: (tags: string[]) => void;
  metricTags?: string[];
  isTabActive: boolean;
  noStickyHeader?: boolean;
  noTooltip?: boolean;
  isBandit?: boolean;
  isGoalMetrics?: boolean;
  ssrPolyfills?: SSRPolyfills;
  disableTimeSeriesButton?: boolean;
  isHoldout?: boolean;
  columnsFilter?: Array<(typeof RESULTS_TABLE_COLUMNS)[number]>;
  sortBy?: "metric-tags" | "significance" | "change" | "custom" | null;
  setSortBy?: (
    s: "metric-tags" | "significance" | "change" | "custom" | null,
  ) => void;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
};

const ROW_HEIGHT = 46;
const METRIC_LABEL_ROW_HEIGHT = 56;
const SPACER_ROW_HEIGHT = 6;

export const RESULTS_TABLE_COLUMNS = [
  "Metric & Variation Names",
  "Baseline Average",
  "Variation Averages",
  "Chance to Win",
  "CI Graph",
  "Lift",
] as const;

export enum RowError {
  QUANTILE_AGGREGATION_ERROR = "QUANTILE_AGGREGATION_ERROR",
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ResultsTable({
  id,
  experimentId,
  isLatestPhase,
  phase,
  status,
  queryStatusData,
  rows,
  dimension,
  tableRowAxis,
  labelHeader,
  editMetrics,
  variations,
  variationFilter,
  baselineRow = 0,
  startDate,
  endDate,
  renderLabelColumn,
  resultGroup,
  dateCreated,
  statsEngine,
  pValueCorrection,
  differenceType,
  sequentialTestingEnabled = false,
  metricTagFilter,
  setMetricTagFilter,
  metricTags = [],
  isTabActive,
  noStickyHeader,
  noTooltip,
  isBandit,
  ssrPolyfills,
  disableTimeSeriesButton,
  columnsFilter,
  isHoldout,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
}: ResultsTableProps) {
  if (variationFilter?.includes(baselineRow)) {
    variationFilter = variationFilter.filter((v) => v !== baselineRow);
  }

  const SortButton = ({ column }: { column: "significance" | "change" }) => {
    if (!setSortBy || !setSortDirection) return null;

    const isActive = sortBy === column;

    const handleClick = () => {
      if (!isActive) {
        // Not currently sorting by this column, set to default direction
        setSortBy(column);
        if (column === "change") {
          // Change: desc, asc, null
          setSortDirection("desc");
        } else if (column === "significance") {
          // Significance: frequentist (desc, asc, null), bayesian (asc, desc, null)
          setSortDirection(statsEngine === "frequentist" ? "desc" : "asc");
        }
      } else {
        // Currently sorting by this column, cycle through directions
        if (column === "change") {
          // Change: desc -> asc -> null
          if (sortDirection === "desc") {
            setSortDirection("asc");
          } else if (sortDirection === "asc") {
            setSortBy(null);
          }
        } else if (column === "significance") {
          // Significance: frequentist (desc -> asc -> null), bayesian (asc -> desc -> null)
          if (statsEngine === "frequentist") {
            if (sortDirection === "desc") {
              setSortDirection("asc");
            } else if (sortDirection === "asc") {
              setSortBy(null);
            }
          } else {
            if (sortDirection === "asc") {
              setSortDirection("desc");
            } else if (sortDirection === "desc") {
              setSortBy(null);
            }
          }
        }
      }
    };

    const getTooltipText = () => {
      if (isActive) {
        return `Sorted by ${column} ${sortDirection === "desc" ? "(desc)" : "(asc)"}`;
      }
      return `Sort by ${column}`;
    };

    const getIcon = () => {
      if (!isActive) return <FaSort size={16} />;
      return sortDirection === "desc" ? (
        <FaSortDown size={16} />
      ) : (
        <FaSortUp size={16} />
      );
    };

    return (
      <Tooltip
        usePortal={true}
        innerClassName={"text-left"}
        body={getTooltipText()}
      >
        <a
          role="button"
          onClick={handleClick}
          style={{
            marginLeft: "2px",
            color: isActive ? "var(--blue-10)" : "var(--gray-a8)",
            userSelect: "none",
          }}
        >
          {getIcon()}
        </a>
      </Tooltip>
    );
  };
  const columnsToDisplay = columnsFilter?.length
    ? columnsFilter
    : RESULTS_TABLE_COLUMNS;

  const { getExperimentMetricById, getFactTableById } = useDefinitions();

  const _useOrganizationMetricDefaults = useOrganizationMetricDefaults();
  const { metricDefaults, getMinSampleSizeForMetric } =
    ssrPolyfills?.useOrganizationMetricDefaults?.() ||
    _useOrganizationMetricDefaults;

  const _confidenceLevels = useConfidenceLevels();
  const _pValueThreshold = usePValueThreshold();
  const _displayCurrency = useCurrency();
  const _orgSettings = useOrgSettings();

  const { ciUpper, ciLower } =
    ssrPolyfills?.useConfidenceLevels?.() || _confidenceLevels;
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold?.() || _pValueThreshold;
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _displayCurrency;
  const orgSettings = ssrPolyfills?.useOrgSettings?.() || _orgSettings;

  const [showMetricFilter, setShowMetricFilter] = useState<boolean>(false);

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphCellWidth, setGraphCellWidth] = useState(800);
  const [tableCellScale, setTableCellScale] = useState(1);

  const { isAuthenticated } = useAuth();
  let showTimeSeriesButton =
    isAuthenticated &&
    baselineRow === 0 &&
    tableRowAxis === "metric" &&
    !disableTimeSeriesButton;

  // Disable time series button for stopped experiments before we added this feature (& therefore data)
  if (status === "stopped" && endDate <= "2025-04-03") {
    showTimeSeriesButton = false;
  }

  const [visibleTimeSeriesRowIds, setVisibleTimeSeriesRowIds] = useState<
    string[]
  >([]);
  const toggleVisibleTimeSeriesRowId = (rowId: string) => {
    setVisibleTimeSeriesRowIds((prev) =>
      prev.includes(rowId)
        ? prev.filter((id) => id !== rowId)
        : [...prev, rowId],
    );
  };

  // Ensure we close all of them if dimension changes
  useEffect(() => {
    setVisibleTimeSeriesRowIds([]);
  }, [tableRowAxis]);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current?.clientWidth as number;
    const firstRowCells = tableContainerRef.current?.querySelectorAll(
      "#main-results thead tr:first-child th:not(.graph-cell)",
    );
    let totalCellWidth = 0;
    for (let i = 0; i < firstRowCells.length; i++) {
      totalCellWidth += firstRowCells[i].clientWidth;
    }
    const graphWidth = tableWidth - totalCellWidth;
    setGraphCellWidth(Math.max(graphWidth, 200));
    setTableCellScale(Math.max(Math.min(1, tableWidth / 1000), 0.85));
  }

  useEffect(() => {
    globalThis.window?.addEventListener("resize", onResize, false);
    return () =>
      globalThis.window?.removeEventListener("resize", onResize, false);
  }, []);
  useLayoutEffect(onResize, []);
  useEffect(onResize, [isTabActive, columnsFilter]);

  const orderedVariations: ExperimentReportVariationWithIndex[] =
    useMemo(() => {
      const sorted = variations
        .map<ExperimentReportVariationWithIndex>((v, i) => ({ ...v, index: i }))
        .sort((a, b) => {
          if (a.index === baselineRow) return -1;
          return a.index - b.index;
        });
      // fix browser .sort() quirks. manually move the control row to top:
      const baselineIndex = sorted.findIndex((v) => v.index === baselineRow);
      if (baselineIndex > -1) {
        const baseline = sorted[baselineIndex];
        sorted.splice(baselineIndex, 1);
        sorted.unshift(baseline);
      }
      return sorted;
    }, [variations, baselineRow]);

  const showVariations = orderedVariations.map(
    (v) => !variationFilter?.includes(v.index),
  );
  const filteredVariations = orderedVariations.filter(
    (v) => !variationFilter?.includes(v.index),
  );
  const compactResults = filteredVariations.length <= 2;

  const domain = useDomain(filteredVariations, rows, differenceType);

  const rowsResults: (RowResults | "query error" | RowError | null)[][] =
    useMemo(() => {
      const rr: (RowResults | "query error" | RowError | null)[][] = [];
      rows.map((row, i) => {
        rr.push([]);
        const baseline = row.variations[baselineRow] || {
          value: 0,
          cr: 0,
          users: 0,
        };
        orderedVariations.map((v) => {
          let skipVariation = false;
          if (variationFilter?.length && variationFilter?.includes(v.index)) {
            skipVariation = true;
          }
          if (v.index === baselineRow) {
            skipVariation = true;
          }
          if (skipVariation) {
            rr[i].push(null);
            return;
          }
          if (
            queryStatusData?.status === "partially-succeeded" &&
            queryStatusData?.failedNames?.includes(row.metric.id)
          ) {
            rr[i].push("query error");
            return;
          }

          if (row.error) {
            rr[i].push(row.error);
            return;
          }

          const stats = row.variations[v.index] || {
            value: 0,
            cr: 0,
            users: 0,
          };

          const denominator =
            !isFactMetric(row.metric) && row.metric.denominator
              ? ((ssrPolyfills?.getExperimentMetricById?.(
                  row.metric.denominator,
                ) ||
                  getExperimentMetricById(row.metric.denominator)) ??
                undefined)
              : undefined;
          const rowResults = getRowResults({
            stats,
            baseline,
            metric: row.metric,
            denominator,
            metricDefaults,
            isGuardrail: row.resultGroup === "guardrail",
            minSampleSize: getMinSampleSizeForMetric(row.metric),
            statsEngine,
            differenceType,
            ciUpper,
            ciLower,
            pValueThreshold,
            snapshotDate: getValidDate(dateCreated),
            phaseStartDate: getValidDate(startDate),
            isLatestPhase,
            experimentStatus: status,
            displayCurrency,
            getFactTableById:
              ssrPolyfills?.getFactTableById || getFactTableById,
          });
          rr[i].push(rowResults);
        });
      });
      return rr;
    }, [
      rows,
      orderedVariations,
      baselineRow,
      variationFilter,
      metricDefaults,
      getMinSampleSizeForMetric,
      statsEngine,
      differenceType,
      ciUpper,
      ciLower,
      pValueThreshold,
      dateCreated,
      startDate,
      isLatestPhase,
      status,
      displayCurrency,
      queryStatusData,
      ssrPolyfills,
      getFactTableById,
      getExperimentMetricById,
    ]);

  const {
    containerRef,
    tooltipOpen,
    tooltipData,
    hoveredX,
    hoveredY,
    hoverRow,
    leaveRow,
    closeTooltip,
    hoveredMetricRow,
    hoveredVariationRow,
    resetTimeout,
  } = useResultsTableTooltip({
    orderedVariations,
    rows,
    rowsResults,
    dimension,
    statsEngine,
    pValueCorrection,
    differenceType,
    noTooltip,
  });

  const noMetrics = rows.length === 0;

  const changeTitle = getEffectLabel(differenceType);

  const hasGoalMetrics = rows.some((r) => r.resultGroup === "goal");
  const appliedPValueCorrection = hasGoalMetrics
    ? (pValueCorrection ?? null)
    : null;

  return (
    <div className="position-relative" ref={containerRef}>
      <CSSTransition
        key={`${hoveredMetricRow}-${hoveredVariationRow}`}
        in={
          tooltipOpen &&
          tooltipData &&
          hoveredX !== null &&
          hoveredY !== null &&
          hoveredMetricRow !== null &&
          hoveredVariationRow !== null
        }
        timeout={200}
        classNames="tooltip-animate"
        appear={true}
      >
        <ResultsTableTooltip
          left={hoveredX ?? 0}
          top={hoveredY ?? 0}
          data={tooltipData}
          tooltipOpen={tooltipOpen}
          close={closeTooltip}
          differenceType={differenceType}
          onPointerMove={resetTimeout}
          onClick={resetTimeout}
          onPointerLeave={leaveRow}
          isBandit={isBandit}
          ssrPolyfills={ssrPolyfills}
        />
      </CSSTransition>

      <div ref={tableContainerRef} className="experiment-results-wrapper">
        <div className="w-100" style={{ minWidth: 700 }}>
          <table id="main-results" className="experiment-results table-sm">
            <thead>
              <tr className="results-top-row" style={{ height: 45 }}>
                {columnsToDisplay.includes("Metric & Variation Names") && (
                  <th
                    className={clsx("axis-col header-label", {
                      noStickyHeader,
                    })}
                    style={{
                      lineHeight: "15px",
                      width: 280 * tableCellScale,
                    }}
                  >
                    <div className="row px-0">
                      {setMetricTagFilter ? (
                        <ResultsMetricFilter
                          metricTags={metricTags}
                          metricTagFilter={metricTagFilter}
                          setMetricTagFilter={setMetricTagFilter}
                          sortBy={sortBy}
                          setSortBy={setSortBy}
                          showMetricFilter={showMetricFilter}
                          setShowMetricFilter={setShowMetricFilter}
                        />
                      ) : (
                        <span className="pl-1" />
                      )}
                      <div
                        className="col-auto px-1"
                        style={{
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {labelHeader}
                      </div>
                      {editMetrics ? (
                        <div className="col d-flex align-items-end px-0">
                          <a
                            role="button"
                            className="ml-1 cursor-pointer link-purple"
                            onClick={(e) => {
                              e.preventDefault();
                              editMetrics();
                            }}
                          >
                            <GBEdit />
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </th>
                )}

                {!noMetrics ? (
                  <>
                    {columnsToDisplay.includes("Baseline Average") && (
                      <th
                        style={{ width: 120 * tableCellScale }}
                        className={clsx("axis-col label", { noStickyHeader })}
                      >
                        <Tooltip
                          usePortal={true}
                          innerClassName={"text-left"}
                          body={
                            <div style={{ lineHeight: 1.5 }}>
                              {isHoldout
                                ? "The holdout variation that all variations are compared against."
                                : "The baseline that all variations are compared against."}
                              <div
                                className={`variation variation${baselineRow} with-variation-label d-flex mt-1 align-items-top`}
                                style={{ marginBottom: 2 }}
                              >
                                <span
                                  className="label mr-1"
                                  style={{
                                    width: 16,
                                    height: 16,
                                    marginTop: 2,
                                  }}
                                >
                                  {baselineRow}
                                </span>
                                <span className="font-weight-bold">
                                  {variations[baselineRow].name}
                                </span>
                              </div>
                            </div>
                          }
                        >
                          {isHoldout ? "Holdout" : "Baseline"} <RxInfoCircled />
                        </Tooltip>
                      </th>
                    )}
                    {columnsToDisplay.includes("Variation Averages") && (
                      <th
                        style={{ width: 120 * tableCellScale }}
                        className={clsx("axis-col label", { noStickyHeader })}
                      >
                        <Tooltip
                          usePortal={true}
                          innerClassName={"text-left"}
                          body={
                            !compactResults ? (
                              ""
                            ) : (
                              <div style={{ lineHeight: 1.5 }}>
                                {isHoldout
                                  ? "The variation being compared to the holdout."
                                  : "The variation being compared to the baseline."}
                                <div
                                  className={`variation variation${filteredVariations[1]?.index} with-variation-label d-flex mt-1 align-items-top`}
                                  style={{ marginBottom: 2 }}
                                >
                                  <span
                                    className="label mr-1"
                                    style={{
                                      width: 16,
                                      height: 16,
                                      marginTop: 2,
                                    }}
                                  >
                                    {filteredVariations[1]?.index}
                                  </span>
                                  <span className="font-weight-bold">
                                    {filteredVariations[1]?.name}
                                  </span>
                                </div>
                              </div>
                            )
                          }
                        >
                          Variation {compactResults ? <RxInfoCircled /> : null}
                        </Tooltip>
                      </th>
                    )}
                    {columnsToDisplay.includes("Chance to Win") && (
                      <th
                        style={{ width: 120 * tableCellScale }}
                        className={clsx("axis-col label", { noStickyHeader })}
                      >
                        {statsEngine === "bayesian" ? (
                          <div
                            className="d-flex align-items-end"
                            style={{ width: 44 }}
                          >
                            <div
                              style={{
                                lineHeight: "15px",
                                marginBottom: 2,
                              }}
                            >
                              <span className="nowrap">Chance</span>{" "}
                              <span className="nowrap">to Win</span>
                            </div>
                            <div style={{ top: -2, position: "relative" }}>
                              <SortButton column="significance" />
                            </div>
                          </div>
                        ) : sequentialTestingEnabled ||
                          appliedPValueCorrection ? (
                          <Tooltip
                            usePortal={true}
                            innerClassName={"text-left"}
                            body={
                              <div style={{ lineHeight: 1.5 }}>
                                {getPValueTooltip(
                                  !!sequentialTestingEnabled,
                                  appliedPValueCorrection,
                                  orgSettings.pValueThreshold ??
                                    DEFAULT_P_VALUE_THRESHOLD,
                                  tableRowAxis,
                                )}
                              </div>
                            }
                          >
                            {appliedPValueCorrection ? "Adj. " : ""}P-value{" "}
                            <RxInfoCircled />
                            <SortButton column="significance" />
                          </Tooltip>
                        ) : (
                          <>
                            P-value
                            <SortButton column="significance" />
                          </>
                        )}
                      </th>
                    )}
                    {columnsToDisplay.includes("CI Graph") && (
                      <th
                        className={clsx("axis-col graph-cell", {
                          noStickyHeader,
                        })}
                        style={{
                          width:
                            (globalThis.window?.innerWidth ?? 900) < 900
                              ? graphCellWidth
                              : undefined,
                          minWidth:
                            (globalThis.window?.innerWidth ?? 900) >= 900
                              ? graphCellWidth
                              : undefined,
                        }}
                      >
                        <div className="position-relative">
                          <AlignedGraph
                            id={`${id}_axis`}
                            domain={domain}
                            significant={true}
                            showAxis={true}
                            axisOnly={true}
                            graphWidth={graphCellWidth}
                            percent={differenceType === "relative"}
                            height={45}
                          />
                        </div>
                      </th>
                    )}
                    {columnsToDisplay.includes("Lift") && (
                      <th
                        style={{ width: 150 * tableCellScale }}
                        className={clsx(
                          "axis-col label text-right text-nowrap",
                          {
                            noStickyHeader,
                          },
                        )}
                      >
                        <div style={{ lineHeight: "15px", marginBottom: 2 }}>
                          <Tooltip
                            usePortal={true}
                            innerClassName={"text-left"}
                            body={
                              <div style={{ lineHeight: 1.5 }}>
                                {getChangeTooltip(
                                  changeTitle,
                                  statsEngine || DEFAULT_STATS_ENGINE,
                                  differenceType,
                                  !!sequentialTestingEnabled,
                                  pValueCorrection ?? null,
                                  pValueThreshold,
                                )}
                              </div>
                            }
                          >
                            {changeTitle} <RxInfoCircled />
                          </Tooltip>
                          <SortButton column="change" />
                        </div>
                      </th>
                    )}
                  </>
                ) : (
                  <th
                    className={clsx("axis-col label", { noStickyHeader })}
                    colSpan={
                      columnsToDisplay.filter(
                        (col) => col !== "Metric & Variation Names",
                      ).length
                    }
                  />
                )}
              </tr>
            </thead>

            {rows.map((row, i) => {
              const baseline = row.variations[baselineRow] || {
                value: 0,
                cr: 0,
                users: 0,
              };
              let alreadyShownQueryError = false;
              let alreadyShownQuantileError = false;

              const rowId = `${row.metric.id}-${i}`;

              const timeSeriesButton = showTimeSeriesButton ? (
                <TimeSeriesButton
                  onClick={() => toggleVisibleTimeSeriesRowId(rowId)}
                  isActive={visibleTimeSeriesRowIds.includes(rowId)}
                />
              ) : null;

              const includedLabelColumns = columnsToDisplay.filter((col) =>
                [
                  "Metric & Variation Names",
                  "Baseline Average",
                  "Variation Averages",
                  "Chance to Win",
                ].includes(col),
              );

              return (
                <React.Fragment key={rowId}>
                  {/* Skip rendering data if this row is hidden by dimension level filter */}
                  {!row.isHiddenByFilter && (
                    <>
                      {/* Render the main results tbody */}
                      <tbody
                        className={clsx("results-group-row", {
                          "slice-row": row.isSliceRow,
                        })}
                        key={i}
                      >
                        {!compactResults &&
                          drawEmptyRow({
                            className: "results-label-row",
                            labelColSpan: includedLabelColumns.length,
                            renderLabel: includedLabelColumns.length > 0,
                            renderGraph: columnsToDisplay.includes("CI Graph"),
                            renderLastColumn: columnsToDisplay.includes("Lift"),
                            label: columnsToDisplay.includes(
                              "Metric & Variation Names",
                            ) ? (
                              renderLabelColumn({
                                label: row.label,
                                metric: row.metric,
                                row,
                                location: resultGroup,
                              })
                            ) : (
                              <></>
                            ),
                            graphCellWidth: columnsToDisplay.includes(
                              "CI Graph",
                            )
                              ? graphCellWidth
                              : 0,
                            rowHeight: METRIC_LABEL_ROW_HEIGHT,
                            id,
                            domain,
                            ssrPolyfills,
                            lastColumnContent:
                              !compactResults && timeSeriesButton !== null ? (
                                <Flex justify="end" mr="1">
                                  {timeSeriesButton}
                                </Flex>
                              ) : undefined,
                          })}

                        {orderedVariations.map((v, j) => {
                          const stats = row.variations[v.index] || {
                            value: 0,
                            cr: 0,
                            users: 0,
                          };
                          const rowResults = rowsResults?.[i]?.[j];
                          if (!rowResults) {
                            return null;
                          }
                          if (
                            rowResults === "query error" ||
                            rowResults === RowError.QUANTILE_AGGREGATION_ERROR
                          ) {
                            const isQueryError = rowResults === "query error";
                            const alreadyShownError = isQueryError
                              ? alreadyShownQueryError
                              : alreadyShownQuantileError;

                            if (!alreadyShownError) {
                              if (isQueryError) {
                                alreadyShownQueryError = true;
                              } else {
                                alreadyShownQuantileError = true;
                              }

                              return drawEmptyRow({
                                key: j,
                                className: clsx(
                                  "results-variation-row align-items-center error-row",
                                  {
                                    "last-before-slice-header":
                                      !row.isSliceRow &&
                                      i < rows.length - 1 &&
                                      rows[i + 1].isSliceRow &&
                                      JSON.stringify(
                                        rows[i + 1].sliceLevels,
                                      ) !==
                                        JSON.stringify(
                                          rows[i]?.sliceLevels || [],
                                        ) &&
                                      j === orderedVariations.length - 1,
                                  },
                                ),
                                labelColSpan: includedLabelColumns.length,
                                renderLabel: includedLabelColumns.length > 0,
                                renderGraph:
                                  columnsToDisplay.includes("CI Graph"),
                                renderLastColumn:
                                  columnsToDisplay.includes("Lift"),
                                label: (
                                  <>
                                    {compactResults ? (
                                      <div className="position-relative">
                                        {renderLabelColumn({
                                          label: row.label,
                                          metric: row.metric,
                                          row,
                                          location: resultGroup,
                                        })}
                                      </div>
                                    ) : null}
                                    <HelperText status="error" size="sm" mx="2">
                                      {isQueryError
                                        ? "Query error"
                                        : "Quantile metrics not available for pre-computed dimensions. Use a custom report instead."}
                                    </HelperText>
                                  </>
                                ),
                                graphCellWidth: columnsToDisplay.includes(
                                  "CI Graph",
                                )
                                  ? graphCellWidth
                                  : 0,
                                rowHeight: compactResults
                                  ? ROW_HEIGHT + 10
                                  : ROW_HEIGHT,
                                id,
                                domain,
                                ssrPolyfills,
                              });
                            } else {
                              return null;
                            }
                          }

                          const hideScaledImpact =
                            !rowResults.hasScaledImpact &&
                            differenceType === "scaled";
                          const isHovered =
                            hoveredMetricRow === i && hoveredVariationRow === j;

                          const resultsHighlightClassname = clsx(
                            rowResults.resultsStatus,
                            {
                              "non-significant": !rowResults.significant,
                              hover: isHovered,
                            },
                          );

                          const onPointerMove = (
                            e,
                            settings?: TooltipHoverSettings,
                          ) => {
                            // No hover tooltip if the screen is too narrow. Clicks still work.
                            if (
                              e?.type === "mousemove" &&
                              (globalThis.window?.innerWidth ?? 900) < 900
                            ) {
                              return;
                            }
                            if (!rowResults.hasData) return;
                            hoverRow(i, j, e, settings);
                          };
                          const onPointerLeave = () => {
                            if (!rowResults.hasData) return;
                            leaveRow();
                          };

                          return (
                            <tr
                              className={clsx(
                                "results-variation-row align-items-center",
                                {
                                  "last-before-slice-header":
                                    !row.isSliceRow &&
                                    i < rows.length - 1 &&
                                    rows[i + 1].isSliceRow &&
                                    JSON.stringify(rows[i + 1].sliceLevels) !==
                                      JSON.stringify(
                                        rows[i]?.sliceLevels || [],
                                      ) &&
                                    j === orderedVariations.length - 1,
                                },
                              )}
                              key={j}
                              style={{
                                height: compactResults
                                  ? ROW_HEIGHT + 10
                                  : ROW_HEIGHT,
                              }}
                            >
                              {columnsToDisplay.includes(
                                "Metric & Variation Names",
                              ) && (
                                <td
                                  className={`variation with-variation-label variation${v.index} position-relative`}
                                  style={{
                                    width: 220 * tableCellScale,
                                  }}
                                >
                                  {!compactResults ? (
                                    <div className="d-flex align-items-center pl-3">
                                      <span
                                        className="label ml-2"
                                        style={{ width: 20, height: 20 }}
                                      >
                                        {v.index}
                                      </span>
                                      <span
                                        className="d-inline-block text-ellipsis"
                                        title={v.name}
                                        style={{
                                          width: 200 * tableCellScale,
                                        }}
                                      >
                                        {v.name}
                                      </span>
                                    </div>
                                  ) : (
                                    renderLabelColumn({
                                      label: row.label,
                                      metric: row.metric,
                                      row,
                                      maxRows: 3,
                                      location: resultGroup,
                                    })
                                  )}
                                </td>
                              )}
                              {columnsToDisplay.includes(
                                "Baseline Average",
                              ) && (
                                <>
                                  {j > 0 ? (
                                    <MetricValueColumn
                                      metric={row.metric}
                                      stats={baseline}
                                      users={baseline?.users || 0}
                                      className={clsx("value baseline", {
                                        hover: isHovered,
                                      })}
                                      showRatio={!isBandit}
                                      displayCurrency={displayCurrency}
                                      getExperimentMetricById={
                                        ssrPolyfills?.getExperimentMetricById ||
                                        getExperimentMetricById
                                      }
                                      getFactTableById={
                                        ssrPolyfills?.getFactTableById ||
                                        getFactTableById
                                      }
                                    />
                                  ) : (
                                    <td />
                                  )}
                                </>
                              )}
                              {columnsToDisplay.includes(
                                "Variation Averages",
                              ) && (
                                <MetricValueColumn
                                  metric={row.metric}
                                  stats={stats}
                                  users={stats?.users || 0}
                                  className={clsx("value", {
                                    hover: isHovered,
                                  })}
                                  showRatio={!isBandit}
                                  displayCurrency={displayCurrency}
                                  getExperimentMetricById={
                                    ssrPolyfills?.getExperimentMetricById ||
                                    getExperimentMetricById
                                  }
                                  getFactTableById={
                                    ssrPolyfills?.getFactTableById ||
                                    getFactTableById
                                  }
                                />
                              )}
                              {columnsToDisplay.includes("Chance to Win") && (
                                <>
                                  {j > 0 ? (
                                    statsEngine === "bayesian" ? (
                                      <ChanceToWinColumn
                                        stats={stats}
                                        baseline={baseline}
                                        rowResults={rowResults}
                                        showRisk={true}
                                        showSuspicious={true}
                                        showPercentComplete={false}
                                        showTimeRemaining={true}
                                        showGuardrailWarning={
                                          row.resultGroup === "guardrail"
                                        }
                                        hideScaledImpact={hideScaledImpact}
                                        className={clsx(
                                          "results-ctw",
                                          resultsHighlightClassname,
                                        )}
                                        onMouseMove={onPointerMove}
                                        onMouseLeave={onPointerLeave}
                                        onClick={onPointerMove}
                                      />
                                    ) : (
                                      <PValueColumn
                                        stats={stats}
                                        baseline={baseline}
                                        rowResults={rowResults}
                                        pValueCorrection={
                                          row.resultGroup === "goal"
                                            ? pValueCorrection
                                            : undefined
                                        }
                                        showRisk={true}
                                        showSuspicious={true}
                                        showPercentComplete={false}
                                        showTimeRemaining={true}
                                        showUnadjustedPValue={false}
                                        showGuardrailWarning={
                                          row.resultGroup === "guardrail"
                                        }
                                        hideScaledImpact={hideScaledImpact}
                                        className={clsx(
                                          "results-pval",
                                          resultsHighlightClassname,
                                        )}
                                        onMouseMove={onPointerMove}
                                        onMouseLeave={onPointerLeave}
                                        onClick={onPointerMove}
                                      />
                                    )
                                  ) : (
                                    <td></td>
                                  )}
                                </>
                              )}
                              {columnsToDisplay.includes("CI Graph") && (
                                <td className="graph-cell">
                                  {j > 0 ? (
                                    <PercentGraph
                                      barType={
                                        statsEngine === "frequentist"
                                          ? "pill"
                                          : undefined
                                      }
                                      barFillType={
                                        statsEngine === "frequentist"
                                          ? "significant"
                                          : "gradient"
                                      }
                                      disabled={hideScaledImpact}
                                      significant={rowResults.significant}
                                      baseline={baseline}
                                      domain={domain}
                                      metric={row.metric}
                                      stats={stats}
                                      id={`${id}_violin_row${i}_var${j}_${
                                        row.resultGroup
                                      }_${encodeURIComponent(dimension ?? "d-none")}`}
                                      graphWidth={graphCellWidth}
                                      height={
                                        compactResults
                                          ? ROW_HEIGHT + 10
                                          : ROW_HEIGHT
                                      }
                                      isHovered={isHovered}
                                      percent={differenceType === "relative"}
                                      className={clsx(
                                        resultsHighlightClassname,
                                        "overflow-hidden",
                                      )}
                                      rowStatus={
                                        statsEngine === "frequentist"
                                          ? rowResults.resultsStatus
                                          : undefined
                                      }
                                      ssrPolyfills={ssrPolyfills}
                                      onMouseMove={(e) =>
                                        onPointerMove(e, {
                                          x: "element-center",
                                          targetClassName: "hover-target",
                                          offsetY: -8,
                                        })
                                      }
                                      onMouseLeave={onPointerLeave}
                                      onClick={(e) =>
                                        onPointerMove(e, {
                                          x: "element-center",
                                          offsetY: -8,
                                        })
                                      }
                                    />
                                  ) : (
                                    <AlignedGraph
                                      id={`${id}_axis`}
                                      domain={domain}
                                      significant={true}
                                      showAxis={false}
                                      percent={differenceType === "relative"}
                                      axisOnly={true}
                                      graphWidth={graphCellWidth}
                                      height={32}
                                      ssrPolyfills={ssrPolyfills}
                                    />
                                  )}
                                </td>
                              )}
                              {columnsToDisplay.includes("Lift") && (
                                <>
                                  {j > 0 ? (
                                    <ChangeColumn
                                      metric={row.metric}
                                      stats={stats}
                                      rowResults={rowResults}
                                      differenceType={differenceType}
                                      statsEngine={statsEngine}
                                      className={clsx(
                                        resultsHighlightClassname,
                                        "pr-3",
                                      )}
                                      ssrPolyfills={ssrPolyfills}
                                      additionalButton={
                                        compactResults
                                          ? timeSeriesButton
                                          : undefined
                                      }
                                    />
                                  ) : (
                                    <td></td>
                                  )}
                                </>
                              )}
                            </tr>
                          );
                        })}

                        {visibleTimeSeriesRowIds.includes(rowId) ? (
                          <tr
                            style={
                              !row.isSliceRow
                                ? { backgroundColor: "var(--slate-a2)" }
                                : undefined
                            }
                          >
                            <td
                              colSpan={columnsToDisplay.length}
                              style={{ padding: 0 }}
                            >
                              <div className={styles.expandAnimation}>
                                <div className={styles.timeSeriesCell}>
                                  <ExperimentMetricTimeSeriesGraphWrapper
                                    experimentId={experimentId}
                                    phase={phase}
                                    experimentStatus={status}
                                    metric={row.metric}
                                    differenceType={differenceType}
                                    variationNames={orderedVariations.map(
                                      (v) => v.name,
                                    )}
                                    showVariations={showVariations}
                                    statsEngine={statsEngine}
                                    pValueAdjustmentEnabled={
                                      !!appliedPValueCorrection &&
                                      rows.length > 1
                                    }
                                    firstDateToRender={getValidDate(startDate)}
                                    sliceId={row.sliceId}
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </table>

          {noMetrics ? (
            <div className="metric-label py-2" style={{ marginLeft: 10 }}>
              <div className="metriclabel text-muted font-weight-bold">
                No metrics yet
              </div>
              <div className="small mt-1 mb-2">
                Add metrics to start tracking the performance of your
                experiment.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function drawEmptyRow({
  key,
  className,
  style,
  label,
  graphCellWidth,
  rowHeight = SPACER_ROW_HEIGHT,
  id,
  domain,
  ssrPolyfills,
  lastColumnContent,
  renderLabel,
  labelColSpan,
  renderGraph,
  renderLastColumn,
}: {
  key?: number | string;
  className?: string;
  style?: CSSProperties;
  label?: string | ReactElement;
  graphCellWidth: number;
  rowHeight?: number;
  id: string;
  domain: [number, number];
  ssrPolyfills?: SSRPolyfills;
  lastColumnContent?: ReactElement;
  renderLabel: boolean;
  labelColSpan: number;
  renderGraph: boolean;
  renderLastColumn: boolean;
}) {
  return (
    <tr key={key} style={{ height: rowHeight, ...style }} className={className}>
      {renderLabel && (
        <td colSpan={labelColSpan} className="position-relative">
          {label}
        </td>
      )}

      {renderGraph && (
        <td className="graph-cell">
          <AlignedGraph
            id={`${id}_axis`}
            domain={domain}
            significant={true}
            showAxis={false}
            axisOnly={true}
            graphWidth={graphCellWidth}
            height={rowHeight}
            ssrPolyfills={ssrPolyfills}
          />
        </td>
      )}

      {renderLastColumn && <td>{lastColumnContent}</td>}
    </tr>
  );
}

function getChangeTooltip(
  changeTitle: string,
  statsEngine: StatsEngine,
  differenceType: DifferenceType,
  sequentialTestingEnabled: boolean,
  pValueCorrection: PValueCorrection,
  pValueThreshold: number,
) {
  let changeText =
    "The uplift comparing the variation to the baseline, in percent change from the baseline value.";
  if (differenceType == "absolute") {
    changeText =
      "The absolute difference between the average values in the variation and the baseline. For non-ratio metrics, this is average difference between users in the variation and the baseline. Differences in proportion metrics are shown in percentage points (pp).";
  } else if (differenceType == "scaled") {
    changeText =
      "The total change in the metric per day if 100% of traffic were to have gone to the variation.";
  }

  const changeElem = (
    <>
      <p>
        <b>{changeTitle}</b> - {changeText}
      </p>
    </>
  );
  let intervalText: ReactNode = null;
  if (statsEngine === "bayesian") {
    intervalText = (
      <>
        The interval is a 95% credible interval. The true value is more likely
        to be in the thicker parts of the graph.
      </>
    );
  }
  if (statsEngine === "frequentist") {
    const confidencePct = percentFormatter.format(1 - pValueThreshold);
    intervalText = (
      <>
        The interval is a {confidencePct} confidence interval. If you re-ran the
        experiment 100 times, the true value would be in this range{" "}
        {confidencePct} of the time.
        {sequentialTestingEnabled && (
          <p className="mt-2 mb-0">
            Because sequential testing is enabled, these confidence intervals
            are valid no matter how many times you analyze (or peek at) this
            experiment as it runs.
          </p>
        )}
        {pValueCorrection && (
          <p className="mt-2 mb-0">
            Because your organization has multiple comparisons corrections
            enabled, these confidence intervals have been inflated so that they
            match the adjusted psuedo-p-value. Because confidence intervals do
            not generally exist for all adjusted p-values, we use a method that
            recreates the confidence intervals that would have produced these
            psuedo-p-values. For adjusted psuedo-p-values that are 1.0, the
            confidence intervals are infinite.
          </p>
        )}
      </>
    );
  }
  return (
    <>
      {changeElem}
      {intervalText && (
        <p className="mt-3">
          <b>Graph</b> - {intervalText}
        </p>
      )}
    </>
  );
}

function getPValueTooltip(
  sequentialTestingEnabled: boolean,
  pValueCorrection: PValueCorrection,
  pValueThreshold: number,
  tableRowAxis: "dimension" | "metric",
) {
  return (
    <>
      {sequentialTestingEnabled && (
        <div className={pValueCorrection ? "mb-3" : ""}>
          Sequential testing is enabled. These are &apos;always valid
          p-values&apos; and robust to peeking. They have a slightly different
          interpretation to normal p-values and can often be 1.000. Nonetheless,
          the interpretation remains that the result is still statistically
          significant if it drops below your threshold ({pValueThreshold}).
        </div>
      )}
      {pValueCorrection && (
        <div>
          The p-values presented below are adjusted for multiple comparisons
          using the {pValueCorrection} method. P-values were adjusted across
          tests for
          {tableRowAxis === "dimension"
            ? " all dimension values, goal metrics, and variations"
            : " all goal metrics and variations"}
          . The unadjusted p-values are returned in the tooltip.
        </div>
      )}
    </>
  );
}
