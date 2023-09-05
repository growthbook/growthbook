import clsx from "clsx";
import {
  CSSProperties,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CSSTransition } from "react-transition-group";
import { RxInfoCircled } from "react-icons/rx";
import { MetricInterface } from "back-end/types/metric";
import {
  ExperimentReportVariation,
  ExperimentReportVariationWithIndex,
} from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getValidDate } from "shared/dates";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { FaExclamationTriangle } from "react-icons/fa";
import {
  ExperimentTableRow,
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
import PercentChangeColumn from "@/components/Experiment/PercentChangeColumn";
import ResultsTableTooltip, {
  TOOLTIP_HEIGHT,
  TOOLTIP_TIMEOUT,
  TOOLTIP_WIDTH,
  TooltipData,
  TooltipHoverSettings,
  LayoutX,
  YAlign,
} from "@/components/Experiment/ResultsTableTooltip";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import Tooltip from "../Tooltip/Tooltip";
import AlignedGraph from "./AlignedGraph";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraph from "./PercentGraph";

export type ResultsTableProps = {
  id: string;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  status: ExperimentStatus;
  queryStatusData?: QueryStatusData;
  isLatestPhase: boolean;
  startDate: string;
  rows: ExperimentTableRow[];
  dimension?: string;
  metricsAsGuardrails?: boolean;
  tableRowAxis: "metric" | "dimension";
  labelHeader: string | JSX.Element;
  editMetrics?: () => void;
  renderLabelColumn: (
    label: string,
    metric: MetricInterface,
    row: ExperimentTableRow,
    maxRows?: number
  ) => string | ReactElement;
  isBreakDown?: boolean;
  dateCreated: Date;
  hasRisk: boolean;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  sequentialTestingEnabled?: boolean;
  isTabActive: boolean;
};

const ROW_HEIGHT = 56;
const METRIC_LABEL_ROW_HEIGHT = 44;
const BREAKDOWN_LABEL_ROW_HEIGHT = 56;
const SPACER_ROW_HEIGHT = 6;

export default function ResultsTable({
  id,
  isLatestPhase,
  status,
  queryStatusData,
  rows,
  dimension,
  metricsAsGuardrails = false,
  tableRowAxis,
  labelHeader,
  editMetrics,
  variations,
  variationFilter,
  baselineRow = 0,
  startDate,
  renderLabelColumn,
  isBreakDown = false,
  dateCreated,
  hasRisk,
  statsEngine,
  pValueCorrection,
  sequentialTestingEnabled = false,
  isTabActive,
}: ResultsTableProps) {
  // fix any potential filter conflicts
  if (variationFilter?.includes(baselineRow)) {
    variationFilter = variationFilter.filter((v) => v !== baselineRow);
  }

  const {
    metricDefaults,
    getMinSampleSizeForMetric,
  } = useOrganizationMetricDefaults();
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();
  const displayCurrency = useCurrency();
  const orgSettings = useOrgSettings();

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphCellWidth, setGraphCellWidth] = useState(800);
  const [tableCellScale, setTableCellScale] = useState(1);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current?.clientWidth as number;
    const firstRowCells = tableContainerRef.current?.querySelectorAll(
      "#main-results thead tr:first-child th:not(.graph-cell)"
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
    window.addEventListener("resize", onResize, false);
    return () => window.removeEventListener("resize", onResize, false);
  }, []);
  useLayoutEffect(onResize, []);
  useEffect(onResize, [isTabActive]);

  const orderedVariations: ExperimentReportVariationWithIndex[] = useMemo(() => {
    return variations
      .map<ExperimentReportVariationWithIndex>((v, i) => ({ ...v, index: i }))
      .sort((a, b) => {
        if (a.index === baselineRow) return -1;
        return a.index - b.index;
      });
  }, [variations, baselineRow]);

  const filteredVariations = orderedVariations.filter(
    (v) => !variationFilter?.includes(v.index)
  );
  const compactResults = filteredVariations.length <= 2;

  const domain = useDomain(filteredVariations, rows);

  const rowsResults: (RowResults | "query error" | null)[][] = useMemo(() => {
    const rr: (RowResults | "query error" | null)[][] = [];
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
        const stats = row.variations[v.index] || {
          value: 0,
          cr: 0,
          users: 0,
        };

        const rowResults = getRowResults({
          stats,
          baseline,
          metric: row.metric,
          metricDefaults,
          isGuardrail: !!metricsAsGuardrails,
          minSampleSize: getMinSampleSizeForMetric(row.metric),
          statsEngine,
          ciUpper,
          ciLower,
          pValueThreshold,
          snapshotDate: getValidDate(dateCreated),
          phaseStartDate: getValidDate(startDate),
          isLatestPhase,
          experimentStatus: status,
          displayCurrency,
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
    metricsAsGuardrails,
    getMinSampleSizeForMetric,
    statsEngine,
    ciUpper,
    ciLower,
    pValueThreshold,
    dateCreated,
    startDate,
    isLatestPhase,
    status,
    displayCurrency,
    queryStatusData,
  ]);

  const noMetrics = rows.length === 0;

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
  } = useTooltip<TooltipData>();
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: false,
  });
  const [hoveredMetricRow, setHoveredMetricRow] = useState<number | null>(null);
  const [hoveredVariationRow, setHoveredVariationRow] = useState<number | null>(
    null
  );
  const [hoveredX, setHoveredX] = useState<number | null>(null);
  const [hoveredY, setHoveredY] = useState<number | null>(null);
  const [hoverTimeout, setHoverTimeout] = useState<number | null>(null);
  const clearHover = () => {
    hideTooltip();
    setHoveredX(null);
    setHoveredY(null);
    setHoveredMetricRow(null);
    setHoveredVariationRow(null);
  };
  const resetTimeout = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
  };
  const hoverRow = (
    metricRow: number,
    variationRow: number,
    event: React.PointerEvent<HTMLElement>,
    settings?: TooltipHoverSettings
  ) => {
    if (
      hoveredMetricRow !== null &&
      hoveredVariationRow !== null &&
      (hoveredMetricRow !== metricRow || hoveredVariationRow !== variationRow)
    ) {
      closeTooltip();
      return;
    }
    resetTimeout();
    if (
      hoveredMetricRow !== null &&
      hoveredVariationRow !== null &&
      hoveredMetricRow === metricRow &&
      hoveredVariationRow === variationRow
    ) {
      // don't recompute tooltip if we're already hovering over the same row
      return;
    }

    const layoutX: LayoutX = settings?.x ?? "element-right";
    const offsetX = settings?.offsetX ?? 0;
    const offsetY = settings?.offsetY ?? 3;
    const el = event.target as HTMLElement;
    const target = settings?.targetClassName
      ? (el.classList.contains(settings.targetClassName)
          ? el
          : el.closest(`.${settings.targetClassName}`)) ?? el
      : (el.tagName === "td" ? el : el.closest("td")) ?? el;

    let yAlign: YAlign = "top";
    let targetTop: number =
      (target.getBoundingClientRect()?.bottom ?? 0) - offsetY;
    if (targetTop > TOOLTIP_HEIGHT + 80) {
      // 80 relates to the various stacked headers
      targetTop =
        (target.getBoundingClientRect()?.top ?? 0) - TOOLTIP_HEIGHT + offsetY;
      yAlign = "bottom";
    }

    let targetLeft: number =
      (layoutX === "element-left"
        ? (target.getBoundingClientRect()?.left ?? 0) - TOOLTIP_WIDTH + 25
        : layoutX === "element-right"
        ? (target.getBoundingClientRect()?.right ?? 0) - 25
        : layoutX === "element-center"
        ? ((target.getBoundingClientRect()?.left ?? 0) +
            (target.getBoundingClientRect()?.right ?? 0)) /
            2 -
          TOOLTIP_WIDTH / 2
        : event.clientX + 10) + offsetX;

    // Prevent tooltip from going off the screen (x-axis)
    if (targetLeft < 10) {
      targetLeft = 10;
    }
    if (
      targetLeft + Math.min(TOOLTIP_WIDTH, window.innerWidth) >
      window.innerWidth - 10
    ) {
      targetLeft =
        window.innerWidth - Math.min(TOOLTIP_WIDTH, window.innerWidth) - 10;
    }

    if (hoveredX === null && hoveredY === null) {
      setHoveredX(targetLeft - containerBounds.left);
      setHoveredY(targetTop - containerBounds.top);
    }

    const row = rows[metricRow];
    const baseline = row.variations[orderedVariations[0].index] || {
      value: 0,
      cr: 0,
      users: 0,
    };
    const stats = row.variations[orderedVariations[variationRow].index] || {
      value: 0,
      cr: 0,
      users: 0,
    };
    const metric = row.metric;
    const variation = orderedVariations[variationRow];
    const baselineVariation = orderedVariations[0];
    const rowResults = rowsResults[metricRow][variationRow];
    if (!rowResults) return;
    if (rowResults === "query error") return;
    showTooltip({
      tooltipData: {
        metricRow,
        metric,
        dimensionName: dimension,
        dimensionValue: dimension ? row.label : undefined,
        variation,
        stats,
        baseline,
        baselineVariation,
        rowResults,
        statsEngine,
        pValueCorrection,
        isGuardrail: !!metricsAsGuardrails,
        layoutX,
        yAlign,
      },
    });
    setHoveredMetricRow(metricRow);
    setHoveredVariationRow(variationRow);
  };
  const leaveRow = () => {
    const timeout = window.setTimeout(clearHover, TOOLTIP_TIMEOUT);
    setHoverTimeout(timeout);
  };
  const closeTooltip = () => {
    resetTimeout();
    clearHover();
  };
  useEffect(() => {
    return () => {
      if (hoverTimeout) clearTimeout(hoverTimeout);
    };
  }, [hoverTimeout]);

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
        timeout={0}
        classNames="tooltip-animate"
        appear={true}
      >
        <ResultsTableTooltip
          left={hoveredX ?? 0}
          top={hoveredY ?? 0}
          data={tooltipData}
          tooltipOpen={tooltipOpen}
          close={closeTooltip}
          onPointerMove={resetTimeout}
          onClick={resetTimeout}
          onPointerLeave={leaveRow}
        />
      </CSSTransition>

      <div ref={tableContainerRef} className="experiment-results-wrapper">
        <div className="w-100" style={{ minWidth: 700 }}>
          <table id="main-results" className="experiment-results table-sm">
            <thead>
              <tr className="results-top-row">
                <th
                  style={{
                    lineHeight: "15px",
                    width: 220 * tableCellScale,
                  }}
                  className="axis-col header-label"
                >
                  {labelHeader}
                  {editMetrics ? (
                    <a
                      role="button"
                      className="ml-2 cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault();
                        editMetrics();
                      }}
                    >
                      <GBEdit />
                    </a>
                  ) : null}
                </th>
                {!noMetrics ? (
                  <>
                    <th
                      style={{ width: 120 * tableCellScale }}
                      className="axis-col label"
                    >
                      <Tooltip
                        usePortal={true}
                        innerClassName={"text-left"}
                        body={
                          <div style={{ lineHeight: 1.5 }}>
                            The baseline that all variations are compared
                            against.
                            <div
                              className={`variation variation${baselineRow} with-variation-label d-flex mt-1 align-items-top`}
                              style={{ marginBottom: 2 }}
                            >
                              <span
                                className="label mr-1"
                                style={{ width: 16, height: 16, marginTop: 2 }}
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
                        Baseline <RxInfoCircled />
                      </Tooltip>
                    </th>
                    <th
                      style={{ width: 120 * tableCellScale }}
                      className="axis-col label"
                    >
                      <Tooltip
                        usePortal={true}
                        innerClassName={"text-left"}
                        body={
                          !compactResults ? (
                            ""
                          ) : (
                            <div style={{ lineHeight: 1.5 }}>
                              The variation being compared to the baseline.
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
                    <th
                      style={{ width: 120 * tableCellScale }}
                      className="axis-col label"
                    >
                      {statsEngine === "bayesian" ? (
                        <div
                          style={{
                            lineHeight: "15px",
                            marginBottom: 2,
                          }}
                        >
                          <span className="nowrap">Chance</span>{" "}
                          <span className="nowrap">to Win</span>
                        </div>
                      ) : !metricsAsGuardrails &&
                        (sequentialTestingEnabled || pValueCorrection) ? (
                        <Tooltip
                          usePortal={true}
                          innerClassName={"text-left"}
                          body={
                            <div style={{ lineHeight: 1.5 }}>
                              {getPValueTooltip(
                                !!sequentialTestingEnabled,
                                pValueCorrection ?? null,
                                orgSettings.pValueThreshold ?? 0.05,
                                tableRowAxis
                              )}
                            </div>
                          }
                        >
                          P-value <RxInfoCircled />
                        </Tooltip>
                      ) : (
                        <>P-value</>
                      )}
                    </th>
                    <th
                      className="axis-col graph-cell"
                      style={{
                        width:
                          window.innerWidth < 900 ? graphCellWidth : undefined,
                        minWidth:
                          window.innerWidth >= 900 ? graphCellWidth : undefined,
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
                          height={45}
                          newUi={true}
                        />
                      </div>
                    </th>
                    <th
                      style={{ width: 140 * tableCellScale }}
                      className="axis-col label text-right"
                    >
                      <div style={{ lineHeight: "15px", marginBottom: 2 }}>
                        <Tooltip
                          usePortal={true}
                          innerClassName={"text-left"}
                          body={
                            <div style={{ lineHeight: 1.5 }}>
                              {getPercentChangeTooltip(
                                statsEngine ?? DEFAULT_STATS_ENGINE,
                                hasRisk,
                                !!sequentialTestingEnabled,
                                pValueCorrection ?? null
                              )}
                            </div>
                          }
                        >
                          % Change <RxInfoCircled />
                        </Tooltip>
                      </div>
                    </th>
                  </>
                ) : (
                  <th className="axis-col label" colSpan={5} />
                )}
              </tr>
            </thead>

            {rows.map((row, i) => {
              const baseline = row.variations[baselineRow] || {
                value: 0,
                cr: 0,
                users: 0,
              };

              return (
                <tbody className={clsx("results-group-row")} key={i}>
                  {!compactResults &&
                    drawEmptyRow({
                      className: "results-label-row bg-light",
                      label: renderLabelColumn(row.label, row.metric, row),
                      graphCellWidth,
                      rowHeight: isBreakDown
                        ? BREAKDOWN_LABEL_ROW_HEIGHT
                        : METRIC_LABEL_ROW_HEIGHT,
                      id,
                      domain,
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
                    if (rowResults === "query error") {
                      if (j > 1) {
                        return null;
                      } else {
                        return drawEmptyRow({
                          key: j,
                          className:
                            "results-variation-row align-items-center error-row",
                          label: (
                            <div className="alert alert-danger px-2 py-1 mb-1 ml-1">
                              <FaExclamationTriangle className="mr-1" />
                              Query error
                            </div>
                          ),
                          graphCellWidth,
                          rowHeight: ROW_HEIGHT,
                          id,
                          domain,
                        });
                      }
                    }
                    const isHovered =
                      hoveredMetricRow === i && hoveredVariationRow === j;

                    const resultsHighlightClassname = clsx(
                      rowResults.resultsStatus,
                      {
                        "non-significant": !rowResults.significant,
                        hover: isHovered,
                      }
                    );

                    const onPointerMove = (
                      e,
                      settings?: TooltipHoverSettings
                    ) => {
                      // No hover tooltip if the screen is too narrow. Clicks still work.
                      if (e?.type === "mousemove" && window.innerWidth < 900) {
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
                        className="results-variation-row align-items-center"
                        key={j}
                      >
                        <td
                          className={`variation with-variation-label variation${v.index}`}
                          style={{
                            width: 220 * tableCellScale,
                          }}
                        >
                          {!compactResults ? (
                            <div className="d-flex align-items-center">
                              <span
                                className="label ml-1"
                                style={{ width: 20, height: 20 }}
                              >
                                {v.index}
                              </span>
                              <span
                                className="d-inline-block text-ellipsis"
                                title={v.name}
                                style={{
                                  width: 165 * tableCellScale,
                                }}
                              >
                                {v.name}
                              </span>
                            </div>
                          ) : (
                            renderLabelColumn(row.label, row.metric, row, 3)
                          )}
                        </td>
                        {j > 0 ? (
                          <MetricValueColumn
                            metric={row.metric}
                            stats={baseline}
                            users={baseline?.users || 0}
                            className={clsx("value baseline", {
                              hover: isHovered,
                            })}
                            newUi={true}
                            onMouseMove={(e) =>
                              onPointerMove(e, {
                                x: "element-right",
                                offsetX: -45,
                              })
                            }
                            onPointerLeave={onPointerLeave}
                            onClick={(e) =>
                              onPointerMove(e, {
                                x: "element-right",
                                offsetX: -45,
                              })
                            }
                          />
                        ) : (
                          <td />
                        )}
                        <MetricValueColumn
                          metric={row.metric}
                          stats={stats}
                          users={stats?.users || 0}
                          className={clsx("value", {
                            hover: isHovered,
                          })}
                          newUi={true}
                          onMouseMove={(e) =>
                            onPointerMove(e, {
                              x: "element-right",
                              offsetX: -45,
                            })
                          }
                          onPointerLeave={onPointerLeave}
                          onClick={(e) =>
                            onPointerMove(e, {
                              x: "element-right",
                              offsetX: -45,
                            })
                          }
                        />
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
                              showGuardrailWarning={metricsAsGuardrails}
                              className={clsx(
                                "results-ctw",
                                resultsHighlightClassname
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
                                !metricsAsGuardrails
                                  ? pValueCorrection
                                  : undefined
                              }
                              showRisk={true}
                              showSuspicious={true}
                              showPercentComplete={false}
                              showTimeRemaining={true}
                              showUnadjustedPValue={false}
                              showGuardrailWarning={metricsAsGuardrails}
                              className={clsx(
                                "results-pval",
                                resultsHighlightClassname
                              )}
                              onMouseMove={onPointerMove}
                              onMouseLeave={onPointerLeave}
                              onClick={onPointerMove}
                            />
                          )
                        ) : (
                          <td></td>
                        )}
                        <td className="graph-cell">
                          {j > 0 ? (
                            <PercentGraph
                              barType={
                                statsEngine === "frequentist"
                                  ? "pill"
                                  : undefined
                              }
                              baseline={baseline}
                              domain={domain}
                              metric={row.metric}
                              stats={stats}
                              id={`${id}_violin_row${i}_var${j}`}
                              graphWidth={graphCellWidth}
                              height={
                                compactResults ? ROW_HEIGHT + 10 : ROW_HEIGHT
                              }
                              newUi={true}
                              // className={}
                              isHovered={isHovered}
                              className={clsx(
                                resultsHighlightClassname,
                                "overflow-hidden"
                              )}
                              rowStatus={rowResults.resultsStatus}
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
                              axisOnly={true}
                              graphWidth={graphCellWidth}
                              height={32}
                              newUi={true}
                            />
                          )}
                        </td>
                        {j > 0 ? (
                          <PercentChangeColumn
                            metric={row.metric}
                            stats={stats}
                            rowResults={rowResults}
                            statsEngine={statsEngine}
                            className={resultsHighlightClassname}
                            onMouseMove={(e) =>
                              onPointerMove(e, {
                                x: "element-left",
                                offsetX: 50,
                              })
                            }
                            onMouseLeave={onPointerLeave}
                            onClick={(e) =>
                              onPointerMove(e, {
                                x: "element-left",
                                offsetX: 50,
                              })
                            }
                          />
                        ) : (
                          <td></td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>

          {noMetrics ? (
            <div className="metric-label py-2" style={{ marginLeft: 10 }}>
              <div className="metriclabel text-muted font-weight-bold">
                No metrics yet
              </div>
              {!metricsAsGuardrails ? (
                <div className="small mt-1 mb-2">
                  Add metrics to start tracking the performance of your
                  experiment.
                </div>
              ) : (
                <div className="small mt-1 mb-2">
                  Add guardrail metrics to ensure that your experiment is not
                  harming any metrics that you aren&apos;t specifically trying
                  to improve.
                </div>
              )}
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
}: {
  key?: number | string;
  className?: string;
  style?: CSSProperties;
  label?: string | ReactElement;
  graphCellWidth: number;
  rowHeight?: number;
  id: string;
  domain: [number, number];
}) {
  return (
    <tr key={key} style={style} className={className}>
      <td colSpan={4}>{label}</td>
      <td className="graph-cell">
        <AlignedGraph
          id={`${id}_axis`}
          domain={domain}
          significant={true}
          showAxis={false}
          axisOnly={true}
          graphWidth={graphCellWidth}
          height={rowHeight}
          newUi={true}
        />
      </td>
      <td />
    </tr>
  );
}

function getPercentChangeTooltip(
  statsEngine: StatsEngine,
  hasRisk: boolean,
  sequentialTestingEnabled: boolean,
  pValueCorrection: PValueCorrection
) {
  if (hasRisk && statsEngine === "bayesian") {
    return (
      <>
        The interval is a 95% credible interval. The true value is more likely
        to be in the thicker parts of the graph.
      </>
    );
  }
  if (statsEngine === "frequentist") {
    return (
      <>
        <p className="mb-0">
          The interval is a 95% confidence interval. If you re-ran the
          experiment 100 times, the true value would be in this range 95% of the
          time.
        </p>
        {sequentialTestingEnabled && (
          <p className="mt-4 mb-0">
            Because sequential testing is enabled, these confidence intervals
            are valid no matter how many times you analyze (or peek at) this
            experiment as it runs.
          </p>
        )}
        {pValueCorrection && (
          <p className="mt-4 mb-0">
            These confidence intervals are not adjusted for multiple comparisons
            as the multiple comparisons adjustments GrowthBook implements only
            have associated adjusted p-values, not confidence intervals.
          </p>
        )}
      </>
    );
  }
  return <></>;
}

function getPValueTooltip(
  sequentialTestingEnabled: boolean,
  pValueCorrection: PValueCorrection,
  pValueThreshold: number,
  tableRowAxis: "dimension" | "metric"
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
            ? "all dimension values, non-guardrail metrics, and variations"
            : "all non-guardrail metrics and variations"}
          . The unadjusted p-values are returned in parentheses.
        </div>
      )}
    </>
  );
}
