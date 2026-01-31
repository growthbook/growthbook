import clsx from "clsx";
import React, {
  CSSProperties,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FaSortUp, FaSortDown, FaSort } from "react-icons/fa";
import {
  ExperimentReportVariation,
  ExperimentReportVariationWithIndex,
} from "shared/types/report";
import { ExperimentStatus } from "shared/types/experiment";
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
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import {
  ExperimentMetricInterface,
  ExperimentSortBy,
  SetExperimentSortBy,
  isFactMetric,
} from "shared/experiments";
import { PiPencilSimpleFill } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import {
  ExperimentTableRow,
  getEffectLabel,
  getRowResults,
  RowResults,
  useDomain,
} from "@/services/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useCurrency } from "@/hooks/useCurrency";
import PValueColumn from "@/components/Experiment/PValueColumn";
import ChangeColumn from "@/components/Experiment/ChangeColumn";
import TimeSeriesButton from "@/components/TimeSeriesButton";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import HelperText from "@/ui/HelperText";
import { DrilldownTooltip, isInteractiveElement } from "./DrilldownTooltip";
import AlignedGraph from "./AlignedGraph";
import ExperimentMetricTimeSeriesGraphWrapper from "./ExperimentMetricTimeSeriesGraphWrapper";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraph from "./PercentGraph";
import styles from "./ResultsTable.module.scss";
import BaselineChooserColumnLabel from "./BaselineChooserColumnLabel";
import DifferenceTypeChooserChangeColumnLabel from "./DifferenceTypeChooserChangeColumnLabel";
import VariationChooserColumnLabel from "./VariationChooserColumnLabel";

export type ResultsTableProps = {
  id: string;
  experimentId: string;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  setVariationFilter?: (variationFilter: number[]) => void;
  baselineRow?: number;
  status: ExperimentStatus;
  queryStatusData?: QueryStatusData;
  isLatestPhase: boolean;
  phase: number;
  startDate: string;
  endDate: string;
  rows: ExperimentTableRow[];
  onRowClick?: (row: ExperimentTableRow) => void;
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
  isTabActive: boolean;
  noStickyHeader?: boolean;
  noTooltip?: boolean;
  isBandit?: boolean;
  isGoalMetrics?: boolean;
  ssrPolyfills?: SSRPolyfills;
  showTimeSeriesButton?: boolean;
  isHoldout?: boolean;
  columnsFilter?: Array<(typeof RESULTS_TABLE_COLUMNS)[number]>;
  sortBy?: ExperimentSortBy;
  setSortBy?: SetExperimentSortBy;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
  setBaselineRow?: (baselineRow: number) => void;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  mutate?: () => Promise<unknown>;
  setDifferenceType?: (differenceType: DifferenceType) => void;
  totalMetricsCount?: number;
  visibleTimeSeriesRowIds?: string[];
  onVisibleTimeSeriesRowIdsChange?: (ids: string[]) => void;
};

const ROW_HEIGHT = 46;
const METRIC_LABEL_ROW_HEIGHT = 56;
const LABEL_ONLY_ROW_HEIGHT = 36;
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
  setVariationFilter,
  baselineRow = 0,
  startDate,
  endDate,
  renderLabelColumn,
  onRowClick,
  resultGroup,
  dateCreated,
  statsEngine,
  pValueCorrection,
  differenceType,
  sequentialTestingEnabled = false,
  isTabActive,
  noStickyHeader,
  noTooltip,
  isBandit,
  ssrPolyfills,
  showTimeSeriesButton: showTimeSeriesButtonProp = false,
  columnsFilter,
  isHoldout,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  setBaselineRow,
  snapshot,
  analysis,
  setAnalysisSettings,
  mutate,
  setDifferenceType,
  totalMetricsCount,
  visibleTimeSeriesRowIds: visibleTimeSeriesRowIdsProp,
  onVisibleTimeSeriesRowIdsChange,
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

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphCellWidth, setGraphCellWidth] = useState(800);
  const [tableCellScale, setTableCellScale] = useState(1);

  const { isAuthenticated } = useAuth();

  const isControlled = visibleTimeSeriesRowIdsProp !== undefined;
  const [internalVisibleTimeSeriesRowIds, setInternalVisibleTimeSeriesRowIds] =
    useState<string[]>(visibleTimeSeriesRowIdsProp ?? []);

  const visibleTimeSeriesRowIds = isControlled
    ? visibleTimeSeriesRowIdsProp
    : internalVisibleTimeSeriesRowIds;

  // Track which rows were initially visible to skip animation for them
  // This will be cleared when user toggles so animation works for user interactions
  const initiallyVisibleRowIdsRef = useRef(
    new Set(visibleTimeSeriesRowIdsProp),
  );

  const toggleVisibleTimeSeriesRowId = (rowId: string) => {
    // Clear the initially visible set on first user toggle so animations work
    if (initiallyVisibleRowIdsRef.current.size > 0) {
      initiallyVisibleRowIdsRef.current.clear();
    }

    const newIds = visibleTimeSeriesRowIds.includes(rowId)
      ? visibleTimeSeriesRowIds.filter((id) => id !== rowId)
      : [...visibleTimeSeriesRowIds, rowId];

    if (isControlled && onVisibleTimeSeriesRowIdsChange) {
      onVisibleTimeSeriesRowIdsChange(newIds);
    } else {
      setInternalVisibleTimeSeriesRowIds(newIds);
    }
  };

  // Ensure we close all of them if dimension changes
  useEffect(() => {
    if (isControlled) {
      return;
    }
    setInternalVisibleTimeSeriesRowIds([]);
  }, [tableRowAxis, isControlled]);

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

  // Watch for table container resizes (e.g., sidebar opening/closing)
  useEffect(() => {
    if (!tableContainerRef.current) return;
    const resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(tableContainerRef.current);
    return () => resizeObserver.disconnect();
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
      queryStatusData,
      ssrPolyfills,
      getExperimentMetricById,
    ]);

  const noRows = rows.length === 0;
  const hasUnfilteredMetrics = (totalMetricsCount ?? 0) > 0;

  const changeTitle = getEffectLabel(differenceType);

  const hasGoalMetrics = rows.some((r) => r.resultGroup === "goal");
  const appliedPValueCorrection = hasGoalMetrics
    ? (pValueCorrection ?? null)
    : null;

  const drilldownEnabled = !!onRowClick && !noTooltip;

  return (
    <DrilldownTooltip enabled={drilldownEnabled}>
      {({ onMouseMove: onRowMouseMove, onMouseLeave: onRowMouseLeave }) => (
        <div className="position-relative">
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
                          width: 260 * tableCellScale,
                        }}
                      >
                        <div className="row px-0">
                          <span className="pl-1" />
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
                                <PiPencilSimpleFill />
                              </a>
                            </div>
                          ) : null}
                        </div>
                      </th>
                    )}

                    {!noRows ? (
                      <>
                        {columnsToDisplay.includes("Baseline Average") && (
                          <th
                            style={{ width: 130 * tableCellScale }}
                            className={clsx("axis-col label", {
                              noStickyHeader,
                            })}
                          >
                            <BaselineChooserColumnLabel
                              variations={variations}
                              baselineRow={baselineRow}
                              setBaselineRow={setBaselineRow}
                              snapshot={snapshot}
                              analysis={analysis}
                              setAnalysisSettings={setAnalysisSettings}
                              mutate={mutate}
                              dropdownEnabled={
                                !isHoldout && snapshot?.dimension !== "pre:date"
                              }
                              isHoldout={isHoldout}
                            />
                          </th>
                        )}
                        {columnsToDisplay.includes("Variation Averages") && (
                          <th
                            style={{ width: 130 * tableCellScale }}
                            className={clsx("axis-col label", {
                              noStickyHeader,
                            })}
                          >
                            <VariationChooserColumnLabel
                              variations={variations}
                              variationFilter={variationFilter ?? []}
                              setVariationFilter={setVariationFilter}
                              baselineRow={baselineRow}
                              dropdownEnabled={
                                !isHoldout && snapshot?.dimension !== "pre:date"
                              }
                              isHoldout={isHoldout}
                            />
                          </th>
                        )}
                        {columnsToDisplay.includes("Chance to Win") && (
                          <th
                            style={{ width: 130 * tableCellScale }}
                            className={clsx("axis-col label nowrap", {
                              noStickyHeader,
                            })}
                          >
                            {statsEngine === "bayesian" ? (
                              <>
                                Chance to Win
                                <SortButton column="significance" />
                              </>
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
                                {appliedPValueCorrection ? "Adj. " : ""}
                                P-value
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
                                (tableContainerRef?.current?.clientWidth ??
                                  900) < 900
                                  ? graphCellWidth
                                  : undefined,
                              minWidth:
                                (tableContainerRef?.current?.clientWidth ??
                                  900) >= 900
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
                            <Flex className="nowrap" align="center">
                              <div className="flex-1" />
                              <DifferenceTypeChooserChangeColumnLabel
                                changeTitle={changeTitle}
                                differenceType={differenceType}
                                setDifferenceType={setDifferenceType}
                                statsEngine={
                                  statsEngine || DEFAULT_STATS_ENGINE
                                }
                                sequentialTestingEnabled={
                                  sequentialTestingEnabled
                                }
                                pValueCorrection={pValueCorrection ?? null}
                                pValueThreshold={pValueThreshold}
                                snapshot={snapshot}
                                phase={phase}
                                analysis={analysis}
                                setAnalysisSettings={setAnalysisSettings}
                                mutate={mutate}
                              />
                              <SortButton column="change" />
                            </Flex>
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
                  let showTimeSeriesButton =
                    showTimeSeriesButtonProp &&
                    isAuthenticated &&
                    baselineRow === 0 &&
                    (tableRowAxis === "metric" ||
                      (tableRowAxis === "dimension" && row.isSliceRow));

                  // Force disabling of time series button for stopped experiments before we added this feature (& therefore data)
                  if (status === "stopped" && endDate <= "2025-04-03") {
                    showTimeSeriesButton = false;
                  }

                  const baseline = row.variations[baselineRow] || {
                    value: 0,
                    cr: 0,
                    users: 0,
                  };
                  let alreadyShownQueryError = false;
                  let alreadyShownQuantileError = false;

                  const rowId = row.sliceId
                    ? `${id}-${row.metric.id}-${row.sliceId}`
                    : `${id}-${row.metric.id}-${i}`;

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
                              [styles.clickableRow]: !!onRowClick,
                            })}
                            key={`${rowId}-tbody`}
                            onClick={
                              onRowClick
                                ? (e) => {
                                    const target = e.target as HTMLElement;
                                    if (!isInteractiveElement(target)) {
                                      onRowClick(row);
                                    }
                                  }
                                : undefined
                            }
                            onMouseMove={onRowMouseMove}
                            onMouseLeave={onRowMouseLeave}
                          >
                            {(() => {
                              const drawRowProps = {
                                labelColSpan: includedLabelColumns.length,
                                renderLabel: includedLabelColumns.length > 0,
                                renderGraph:
                                  columnsToDisplay.includes("CI Graph"),
                                renderLastColumn:
                                  columnsToDisplay.includes("Lift"),
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
                                id,
                                domain,
                                ssrPolyfills,
                              };

                              if (row.labelOnly) {
                                return drawLabelRow({
                                  ...drawRowProps,
                                  rowHeight: LABEL_ONLY_ROW_HEIGHT,
                                });
                              }

                              if (!compactResults) {
                                return drawEmptyRow({
                                  ...drawRowProps,
                                  className: "results-label-row",
                                  rowHeight: METRIC_LABEL_ROW_HEIGHT,
                                  lastColumnContent:
                                    timeSeriesButton !== null ? (
                                      <Flex justify="end" mr="1">
                                        {timeSeriesButton}
                                      </Flex>
                                    ) : undefined,
                                });
                              }

                              return null;
                            })()}

                            {!row.labelOnly &&
                              orderedVariations.map((v, j) => {
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
                                  rowResults ===
                                    RowError.QUANTILE_AGGREGATION_ERROR
                                ) {
                                  const isQueryError =
                                    rowResults === "query error";
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
                                      renderLabel:
                                        includedLabelColumns.length > 0,
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
                                          <HelperText
                                            status="error"
                                            size="sm"
                                            mx="2"
                                          >
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

                                const resultsHighlightClassname = clsx(
                                  rowResults.resultsStatus,
                                  {
                                    "non-significant": !rowResults.significant,
                                  },
                                );

                                return (
                                  <tr
                                    className={clsx(
                                      "results-variation-row align-items-center",
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
                                          <div
                                            className={`d-flex align-items-center ${
                                              row.isSliceRow
                                                ? "pl-4"
                                                : dimension
                                                  ? "pl-2" // less padding because no expansion buttons
                                                  : "pl-3"
                                            }`}
                                          >
                                            <span
                                              className="label ml-2"
                                              style={{
                                                width: 20,
                                                height: 20,
                                              }}
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
                                            className="value baseline"
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
                                        className="value"
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
                                    {columnsToDisplay.includes(
                                      "Chance to Win",
                                    ) && (
                                      <>
                                        {j > 0 ? (
                                          statsEngine === "bayesian" ? (
                                            <ChanceToWinColumn
                                              stats={stats}
                                              baseline={baseline}
                                              rowResults={rowResults}
                                              showSuspicious={true}
                                              showPercentComplete={false}
                                              showTimeRemaining={true}
                                              hideScaledImpact={
                                                hideScaledImpact
                                              }
                                              className={clsx(
                                                "results-ctw",
                                                resultsHighlightClassname,
                                              )}
                                              metric={row.metric}
                                              differenceType={differenceType}
                                              statsEngine={statsEngine}
                                              ssrPolyfills={ssrPolyfills}
                                              minSampleSize={getMinSampleSizeForMetric(
                                                row.metric,
                                              )}
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
                                              showSuspicious={true}
                                              showPercentComplete={false}
                                              showTimeRemaining={true}
                                              showUnadjustedPValue={false}
                                              hideScaledImpact={
                                                hideScaledImpact
                                              }
                                              className={clsx(
                                                "results-pval",
                                                resultsHighlightClassname,
                                              )}
                                              metric={row.metric}
                                              differenceType={differenceType}
                                              statsEngine={statsEngine}
                                              ssrPolyfills={ssrPolyfills}
                                              minSampleSize={getMinSampleSizeForMetric(
                                                row.metric,
                                              )}
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
                                            percent={
                                              differenceType === "relative"
                                            }
                                            differenceType={differenceType}
                                            className={clsx(
                                              resultsHighlightClassname,
                                              "overflow-hidden",
                                            )}
                                            rowStatus={
                                              statsEngine === "frequentist"
                                                ? rowResults.resultsStatus
                                                : undefined
                                            }
                                            resultsStatus={
                                              rowResults.resultsStatus
                                            }
                                            statsEngine={statsEngine}
                                            ssrPolyfills={ssrPolyfills}
                                            suspiciousChange={
                                              rowResults.suspiciousChange
                                            }
                                            notEnoughData={
                                              !rowResults.enoughData
                                            }
                                            minSampleSize={getMinSampleSizeForMetric(
                                              row.metric,
                                            )}
                                            minPercentChange={
                                              rowResults.minPercentChange
                                            }
                                          />
                                        ) : (
                                          <AlignedGraph
                                            id={`${id}_axis`}
                                            domain={domain}
                                            significant={true}
                                            showAxis={false}
                                            percent={
                                              differenceType === "relative"
                                            }
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
                                            minSampleSize={getMinSampleSizeForMetric(
                                              row.metric,
                                            )}
                                          />
                                        ) : (
                                          <td></td>
                                        )}
                                      </>
                                    )}
                                  </tr>
                                );
                              })}

                            {!row.labelOnly &&
                              visibleTimeSeriesRowIds.includes(rowId) && (
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
                                    <div
                                      className={
                                        initiallyVisibleRowIdsRef.current.has(
                                          rowId,
                                        )
                                          ? undefined
                                          : styles.expandAnimation
                                      }
                                    >
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
                                          firstDateToRender={getValidDate(
                                            startDate,
                                          )}
                                          sliceId={row.sliceId}
                                          baselineRow={baselineRow}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                          </tbody>
                        </>
                      )}
                    </React.Fragment>
                  );
                })}
              </table>
              {noRows ? (
                <div className="text-muted ml-2 pl-1 py-2">
                  {hasUnfilteredMetrics ? (
                    <em>Some metrics are hidden by filters.</em>
                  ) : (
                    <>
                      <em>No metrics yet</em>
                      <div className="small">
                        Add metrics to start tracking the performance of your
                        experiment.
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </DrilldownTooltip>
  );
}

function drawLabelRow({
  labelColSpan,
  renderLabel,
  renderGraph,
  renderLastColumn,
  label,
  graphCellWidth,
  rowHeight = METRIC_LABEL_ROW_HEIGHT,
  id,
  domain,
  ssrPolyfills,
}: {
  labelColSpan: number;
  renderLabel: boolean;
  renderGraph: boolean;
  renderLastColumn: boolean;
  label?: string | ReactElement;
  graphCellWidth: number;
  rowHeight?: number;
  id: string;
  domain: [number, number];
  ssrPolyfills?: SSRPolyfills;
}) {
  return (
    <tr style={{ height: rowHeight }} className="results-label-row">
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

      {renderLastColumn && <td></td>}
    </tr>
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
