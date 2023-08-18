import clsx from "clsx";
import React, {
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
import { ExperimentReportVariation } from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getValidDate } from "shared/dates";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
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
import Tooltip from "../Tooltip/Tooltip";
import AlignedGraph from "./AlignedGraph";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraph from "./PercentGraph";

export type ResultsTableProps = {
  id: string;
  variations: ExperimentReportVariation[];
  status: ExperimentStatus;
  isLatestPhase: boolean;
  startDate: string;
  rows: ExperimentTableRow[];
  metricsAsGuardrails?: boolean;
  tableRowAxis: "metric" | "dimension";
  labelHeader: string;
  editMetrics?: () => void;
  renderLabelColumn: (
    label: string,
    metric: MetricInterface,
    row: ExperimentTableRow
  ) => string | ReactElement;
  dateCreated: Date;
  hasRisk: boolean;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  sequentialTestingEnabled?: boolean;
  showAdvanced: boolean;
  isTabActive: boolean;
};

export default function ResultsTable({
  id,
  isLatestPhase,
  status,
  rows,
  metricsAsGuardrails = false,
  tableRowAxis,
  labelHeader,
  editMetrics,
  variations,
  startDate,
  renderLabelColumn,
  dateCreated,
  hasRisk,
  statsEngine,
  pValueCorrection,
  sequentialTestingEnabled = false,
  showAdvanced,
  isTabActive,
}: ResultsTableProps) {
  const {
    metricDefaults,
    getMinSampleSizeForMetric,
  } = useOrganizationMetricDefaults();
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();
  const displayCurrency = useCurrency();
  const orgSettings = useOrgSettings();
  const domain = useDomain(variations, rows);

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphCellWidth, setGraphCellWidth] = useState(200);
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
    setTableCellScale(Math.max(Math.min(1, tableWidth / 1000), 0.5));
  }

  useEffect(() => {
    window.addEventListener("resize", onResize, false);
    return () => window.removeEventListener("resize", onResize, false);
  }, []);
  useLayoutEffect(onResize, []);
  useEffect(onResize, [showAdvanced, isTabActive]);

  const baselineRow = 0;

  const rowsResults: (RowResults | null)[][] = useMemo(() => {
    const rr: (RowResults | null)[][] = [];
    rows.map((row, i) => {
      rr.push([]);
      const baseline = row.variations[baselineRow] || {
        value: 0,
        cr: 0,
        users: 0,
      };
      variations.map((v, j) => {
        let skipVariation = false; // todo: use filter
        if (j === baselineRow) {
          skipVariation = true;
        }
        if (skipVariation) {
          rr[i].push(null);
          return;
        }
        const stats = row.variations[j] || {
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
    variations,
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
    const offsetY = settings?.offsetY ?? 0;
    const el = event.target as HTMLElement;
    const target = settings?.targetClassName
      ? (el.classList.contains(settings.targetClassName)
          ? el
          : el.closest(`.${settings.targetClassName}`)) ?? el
      : (el.tagName === "td" ? el : el.closest("td")) ?? el;

    let yAlign: YAlign = "top";
    let targetTop: number =
      (target.getBoundingClientRect()?.top ?? 0) + 30 + offsetY;
    if (targetTop > TOOLTIP_HEIGHT + 80) {
      targetTop -= 29 + TOOLTIP_HEIGHT - offsetY;
      yAlign = "bottom";
    }

    const targetLeft: number =
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

    if (hoveredX === null && hoveredY === null) {
      setHoveredX(targetLeft - containerBounds.left);
      setHoveredY(targetTop - containerBounds.top);
    }

    const row = rows[metricRow];
    const baseline = row.variations[baselineRow] || {
      value: 0,
      cr: 0,
      users: 0,
    };
    const stats = row.variations[variationRow] || {
      value: 0,
      cr: 0,
      users: 0,
    };
    const metric = row.metric;
    const variation = variations[variationRow];
    const baselineVariation = variations[baselineRow];
    const rowResults = rowsResults[metricRow][variationRow];
    if (!rowResults) return;
    showTooltip({
      tooltipData: {
        metricRow,
        variationRow,
        metric,
        variation,
        stats,
        baseline,
        baselineVariation,
        baselineRow,
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
          close={closeTooltip}
          onPointerMove={resetTimeout}
          onClick={resetTimeout}
          onPointerLeave={leaveRow}
        />
      </CSSTransition>

      <div ref={tableContainerRef} style={{ minWidth: 600 }}>
        <div className="w-100">
          <table
            id="main-results"
            className="experiment-results table-borderless table-sm"
          >
            <thead>
              <tr className="results-top-row">
                <th
                  style={{
                    lineHeight: "16px",
                    width: (showAdvanced ? 180 : 220) * tableCellScale,
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
                    {showAdvanced ? (
                      <>
                        <th
                          style={{
                            width: 110 * tableCellScale,
                            lineHeight: "16px",
                          }}
                          className="axis-col label"
                        >
                          Baseline
                          <div
                            className={`variation variation${baselineRow} with-variation-label d-inline-flex align-items-center`}
                            style={{ marginBottom: 2 }}
                          >
                            <span
                              className="label"
                              style={{ width: 16, height: 16 }}
                            >
                              {baselineRow}
                            </span>
                            <span
                              className="d-inline-block text-ellipsis font-weight-bold"
                              style={{
                                width: 80 * tableCellScale,
                                marginRight: -20,
                              }}
                            >
                              {variations[baselineRow].name}
                            </span>
                          </div>
                        </th>
                        <th
                          style={{ width: 110 * tableCellScale }}
                          className="axis-col label"
                        >
                          Value
                        </th>
                      </>
                    ) : null}
                    <th
                      style={{ width: 120 * tableCellScale }}
                      className="axis-col label text-right has-tooltip"
                    >
                      {statsEngine === "bayesian" ? (
                        <div style={{ lineHeight: "16px", marginBottom: 2 }}>
                          <span className="nowrap">Chance</span>{" "}
                          <span className="nowrap">to Win</span>
                        </div>
                      ) : !metricsAsGuardrails &&
                        (sequentialTestingEnabled || pValueCorrection) ? (
                        <Tooltip
                          innerClassName={"text-left"}
                          body={
                            <div style={{ lineHeight: 1.5 }}>
                              {getPValueTooltip(
                                !!sequentialTestingEnabled,
                                pValueCorrection ?? null,
                                orgSettings.pValueThreshold ?? 0.05,
                                tableRowAxis,
                                showAdvanced
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
                      style={{ maxWidth: graphCellWidth }}
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
                      style={{
                        width:
                          (showAdvanced ? 140 : 120) *
                          Math.max(0.75, tableCellScale),
                      }}
                      className="axis-col label text-right has-tooltip"
                    >
                      <div style={{ lineHeight: "16px", marginBottom: 2 }}>
                        <Tooltip
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
                  <th
                    className="axis-col label"
                    colSpan={showAdvanced ? 5 : 3}
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

              return (
                <tbody
                  className="results-group-row"
                  key={i}
                  style={{
                    backgroundColor:
                      i % 2 === 1 ? "rgb(127 127 127 / 8%)" : "transparent",
                  }}
                >
                  <tr className="results-label-row">
                    <th
                      colSpan={showAdvanced ? 4 : 2}
                      className="metric-label pb-1"
                    >
                      {renderLabelColumn(row.label, row.metric, row)}
                    </th>
                    <th className="graph-cell">
                      <AlignedGraph
                        id={`${id}_axis`}
                        domain={domain}
                        significant={true}
                        showAxis={false}
                        axisOnly={true}
                        graphWidth={graphCellWidth}
                        height={35}
                        newUi={true}
                      />
                    </th>
                    <th />
                  </tr>

                  {variations.map((v, j) => {
                    const stats = row.variations[j] || {
                      value: 0,
                      cr: 0,
                      users: 0,
                    };
                    const rowResults = rowsResults?.[i]?.[j];
                    if (!rowResults) {
                      return null;
                    }
                    const isHovered =
                      hoveredMetricRow === i && hoveredVariationRow === j;

                    // todo: move highlight state to getRowResults()
                    const resultsStatusClassname = !rowResults.significant
                      ? ""
                      : rowResults.resultsStatus;
                    const resultsHighlightClassname = clsx(
                      resultsStatusClassname,
                      {
                        significant: rowResults.significant,
                        "non-significant": !rowResults.significant,
                        hover: isHovered,
                      }
                    );

                    const onPointerMove = (
                      e,
                      settings?: TooltipHoverSettings
                    ) => hoverRow(i, j, e, settings);
                    const onPointerLeave = () => leaveRow();

                    return (
                      <tr
                        className="results-variation-row align-items-center"
                        key={j}
                      >
                        <td
                          className={`variation with-variation-label variation${j} d-inline-flex align-items-center`}
                          style={{
                            width: (showAdvanced ? 180 : 220) * tableCellScale,
                            paddingTop: 6,
                          }}
                        >
                          <span
                            className="label ml-1"
                            style={{ width: 20, height: 20 }}
                          >
                            {j}
                          </span>
                          <span
                            className="d-inline-block text-ellipsis font-weight-bold"
                            style={{
                              width:
                                (showAdvanced ? 125 : 165) * tableCellScale,
                            }}
                          >
                            {v.name}
                          </span>
                        </td>
                        {showAdvanced && j === 1 ? (
                          // draw baseline value once, merge rows
                          <MetricValueColumn
                            metric={row.metric}
                            stats={baseline}
                            users={baseline?.users || 0}
                            style={{ backgroundColor: "rgb(127 127 127 / 6%)" }}
                            className="value variation"
                            rowSpan={row.variations.length - 1}
                          />
                        ) : null}
                        {showAdvanced ? (
                          <MetricValueColumn
                            metric={row.metric}
                            stats={stats}
                            users={stats?.users || 0}
                            className={clsx("value variation", {
                              hover: isHovered,
                            })}
                            onPointerMove={onPointerMove}
                            onPointerLeave={onPointerLeave}
                            onClick={onPointerMove}
                          />
                        ) : null}
                        {j > 0 ? (
                          statsEngine === "bayesian" ? (
                            <ChanceToWinColumn
                              stats={stats}
                              baseline={baseline}
                              rowResults={rowResults}
                              showRisk={true}
                              showSuspicious={true}
                              showPercentComplete={false}
                              showTimeRemaining={false}
                              showGuardrailWarning={metricsAsGuardrails}
                              className={clsx(
                                "text-right results-pval",
                                resultsHighlightClassname
                              )}
                              onPointerMove={onPointerMove}
                              onPointerLeave={onPointerLeave}
                              onClick={onPointerMove}
                            />
                          ) : (
                            <PValueColumn
                              stats={stats}
                              baseline={baseline}
                              rowResults={rowResults}
                              pValueCorrection={pValueCorrection}
                              showRisk={true}
                              showSuspicious={true}
                              showPercentComplete={false}
                              showTimeRemaining={false}
                              showUnadjustedPValue={showAdvanced}
                              showGuardrailWarning={metricsAsGuardrails}
                              className={clsx(
                                "text-right results-pval",
                                resultsHighlightClassname
                              )}
                              onPointerMove={onPointerMove}
                              onPointerLeave={onPointerLeave}
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
                              height={32}
                              newUi={true}
                              isHovered={isHovered}
                              onPointerMove={(e) =>
                                onPointerMove(e, {
                                  x: "element-center",
                                  targetClassName: "hover-target",
                                  offsetY: -5,
                                })
                              }
                              onPointerLeave={onPointerLeave}
                              onClick={(e) =>
                                onPointerMove(e, {
                                  x: "element-center",
                                  offsetY: -5,
                                })
                              }
                              className={resultsHighlightClassname}
                              rowStatus={resultsStatusClassname}
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
                            showCI={showAdvanced}
                            className={resultsHighlightClassname}
                            onPointerMove={(e) =>
                              onPointerMove(e, {
                                x: "element-left",
                                offsetX: showAdvanced ? 5 : 50,
                              })
                            }
                            onPointerLeave={onPointerLeave}
                            onClick={(e) =>
                              onPointerMove(e, {
                                x: "element-left",
                                offsetX: showAdvanced ? 5 : 50,
                              })
                            }
                          />
                        ) : (
                          <td></td>
                        )}
                      </tr>
                    );
                  })}

                  {/*spacer row*/}
                  <tr
                    className="results-label-row"
                    style={{ lineHeight: "1px" }}
                  >
                    <td></td>
                    {showAdvanced ? (
                      <>
                        <td></td>
                        <td></td>
                      </>
                    ) : null}
                    <td></td>
                    <td className="graph-cell">
                      <AlignedGraph
                        id={`${id}_axis`}
                        domain={domain}
                        significant={true}
                        showAxis={false}
                        axisOnly={true}
                        graphWidth={graphCellWidth}
                        height={10}
                        newUi={true}
                      />
                    </td>
                    <td></td>
                  </tr>
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
  tableRowAxis: "dimension" | "metric",
  showAdvanced: boolean
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
          .
          {showAdvanced
            ? " The unadjusted p-values are returned in parentheses."
            : ""}
        </div>
      )}
    </>
  );
}
