import clsx from "clsx";
import React, {
  ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FaArrowDown, FaArrowUp, FaQuestionCircle } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentReportVariation } from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getValidDate } from "shared/dates";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { BsXCircle } from "react-icons/bs";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
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
import GuardrailResult from "@/components/Experiment/GuardrailResult";
import PValueGuardrailResults from "@/components/Experiment/PValueGuardrailResult";
import { useCurrency } from "@/hooks/useCurrency";
import PValueColumn from "@/components/Experiment/PValueColumn";
import PercentChangeColumn from "@/components/Experiment/PercentChangeColumn";
import Tooltip from "../Tooltip/Tooltip";
import AlignedGraph from "./AlignedGraph";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraph from "./PercentGraph";

const TOOLTIP_WIDTH = 400;
const TOOLTIP_HEIGHT = 300;
const TOOLTIP_TIMEOUT = 250;
type TooltipHoverSettings = {
  x: TooltipHoverX;
};
type TooltipHoverX = "mouse-left" | "mouse-right" | "element-center";

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
};

export default function ResultsTable({
  id,
  isLatestPhase,
  status,
  rows,
  metricsAsGuardrails,
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
  showAdvanced = false,
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
  const [graphCellWidth, setGraphCellWidth] = useState(0);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current?.clientWidth as number;
    const firstRowCells = tableContainerRef.current?.querySelectorAll(
      "#main-results thead tr:first-child th:not(.graphCell)"
    );
    let totalCellWidth = 0;
    if (firstRowCells) {
      for (let i = 0; i < firstRowCells.length; i++) {
        totalCellWidth += firstRowCells[i].clientWidth;
      }
    }
    const graphWidth = tableWidth - totalCellWidth;
    setGraphCellWidth(graphWidth);
  }

  useEffect(() => {
    window.addEventListener("resize", onResize, false);
    return () => window.removeEventListener("resize", onResize, false);
  }, []);
  useLayoutEffect(() => {
    onResize();
  }, []);
  useEffect(() => {
    onResize();
  }, [showAdvanced]);

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

  // done: reconcile positive/negative change coloring with PValueColumn and ChanceToWinColumn (draw, etc)

  // todo: fullStats toggle
  // todo: hasRisk toggle. minimally supported now, but should be more thoughtful
  // done: some CI info in the % Change column (togglable?)
  // todo: tooltips

  // done: highlighting, risk (SelectField?), significance, etc
  //    Risk is always in the tooltip, and continue to be shaded as it currently is wrt the
  //    acceptable and unacceptable risk levels.
  //
  //    However, we only surface it in the Chance To Win column if:
  //      - CTW > 95% (or threshold) AND risk of Variation is NOT acceptable
  //      - OR if CTW < 5% (or 100-threshold) AND risk of Control is NOT acceptable.

  // todo: StatusBanner?

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
    hoverTimeout && clearTimeout(hoverTimeout);

    const layoutX: TooltipHoverX = settings?.x ?? "mouse-left";
    const el = event.target as HTMLElement;
    const target = (el.tagName === "td" ? el : el.closest("td")) ?? el;

    let targetTop: number = (target.getBoundingClientRect()?.top ?? 0) + 20;
    if (targetTop > TOOLTIP_HEIGHT + 80) {
      targetTop -= 30 + TOOLTIP_HEIGHT;
    }

    const targetLeft: number =
      layoutX === "mouse-left"
        ? event.clientX + 10
        : layoutX === "element-center"
        ? ((target.getBoundingClientRect()?.left ?? 0) +
            (target.getBoundingClientRect()?.right ?? 0)) /
            2 -
          TOOLTIP_WIDTH / 2
        : event.clientX - TOOLTIP_WIDTH - 10;

    const x = hoveredX !== null ? hoveredX : targetLeft - containerBounds.left;
    const y = hoveredY !== null ? hoveredY : targetTop - containerBounds.top;
    if (hoveredX === null || hoveredY === null) {
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
    const tooltipData: TooltipData = {
      metricRow: metricRow,
      variationRow: variationRow,
      metric: row.metric,
      variation: variations[variationRow],
      stats: stats,
      baseline: baseline,
      rowResults: rowsResults[metricRow][variationRow],
      statsEngine,
      pValueCorrection,
      isGuardrail: metricsAsGuardrails,
    };
    showTooltip({
      tooltipLeft: x ?? 0,
      tooltipTop: y ?? 0,
      tooltipData: tooltipData,
    });
    setHoveredMetricRow(metricRow);
    setHoveredVariationRow(variationRow);
  };
  const leaveRow = () => {
    const timeout = window.setTimeout(() => {
      hideTooltip();
      setHoveredX(null);
      setHoveredY(null);
      setHoveredMetricRow(null);
      setHoveredVariationRow(null);
    }, TOOLTIP_TIMEOUT);
    setHoverTimeout(timeout);
  };
  const closeTooltip = () => {
    hoverTimeout && clearTimeout(hoverTimeout);
    hideTooltip();
    setHoveredX(null);
    setHoveredY(null);
    setHoveredMetricRow(null);
    setHoveredVariationRow(null);
  };
  useEffect(() => {
    return () => {
      hoverTimeout && clearTimeout(hoverTimeout);
    };
  }, [hoverTimeout]);

  return (
    <div className="position-relative" ref={containerRef}>
      {tooltipOpen &&
      hoveredMetricRow !== undefined &&
      hoveredVariationRow !== undefined ? (
        <TooltipWithBounds
          left={hoveredX ?? undefined}
          top={hoveredY ?? undefined}
          style={{ position: "absolute", zIndex: 900 }}
        >
          <div
            className="experiment-row-tooltip"
            style={{ width: TOOLTIP_WIDTH, height: TOOLTIP_HEIGHT }}
            onPointerMove={(e) =>
              hoverRow(hoveredMetricRow ?? 0, hoveredVariationRow ?? 0, e)
            }
            onPointerLeave={leaveRow}
          >
            <a
              role="button"
              style={{
                top: 3,
                right: 5,
              }}
              className="position-absolute text-link cursor-pointer"
              onClick={closeTooltip}
            >
              <BsXCircle size={16} />
            </a>
            {getTooltipContents(tooltipData)}
          </div>
        </TooltipWithBounds>
      ) : null}

      <div
        ref={tableContainerRef}
        style={{ minWidth: showAdvanced ? 1000 : 800 }}
      >
        <div className="w-100 overflow-auto">
          <table
            id="main-results"
            className="experiment-results table-borderless table-sm"
          >
            <thead>
              <tr className="results-top-row">
                <th
                  style={{ width: showAdvanced ? 180 : 220 }}
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
                {showAdvanced ? (
                  <>
                    <th
                      style={{ width: 110, lineHeight: "16px" }}
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
                          style={{ width: 80, marginRight: -20 }}
                        >
                          {variations[baselineRow].name}
                        </span>
                      </div>
                    </th>
                    <th style={{ width: 110 }} className="axis-col label">
                      Value
                    </th>
                  </>
                ) : null}
                <th
                  style={{ width: 140 }}
                  className="axis-col label text-right"
                >
                  {statsEngine === "bayesian" ? (
                    !metricsAsGuardrails ? (
                      <>Chance to Win</>
                    ) : (
                      <div style={{ lineHeight: "16px" }}>
                        <span className="nowrap">Chance of</span>{" "}
                        <span className="nowrap">Being Worse</span>
                      </div>
                    )
                  ) : !metricsAsGuardrails &&
                    (sequentialTestingEnabled || pValueCorrection) ? (
                    <Tooltip
                      innerClassName={"text-left"}
                      body={getPValueTooltip(
                        !!sequentialTestingEnabled,
                        pValueCorrection ?? null,
                        orgSettings.pValueThreshold ?? 0.05,
                        tableRowAxis
                      )}
                    >
                      P-value <FaQuestionCircle />
                    </Tooltip>
                  ) : (
                    <>P-value</>
                  )}
                </th>
                <th
                  className="axis-col graphCell position-relative"
                  style={{ maxWidth: graphCellWidth }}
                >
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
                  <Tooltip
                    className={"position-absolute"}
                    style={{
                      bottom: 8,
                      right: -18,
                      color: "var(--text-link-hover-color)",
                    }}
                    innerClassName={"text-left"}
                    body={getPercentChangeTooltip(
                      statsEngine ?? DEFAULT_STATS_ENGINE,
                      hasRisk,
                      !!sequentialTestingEnabled,
                      pValueCorrection ?? null
                    )}
                  >
                    <FaQuestionCircle />
                  </Tooltip>
                </th>
                <th
                  style={{ width: showAdvanced ? 140 : 170 }}
                  className="axis-col label text-right"
                >
                  % Change
                </th>
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
                    <th>
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
                    <th></th>
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
                    const resultsHighlightClassname = clsx({
                      significant: rowResults.significant,
                      "non-significant": !rowResults.significant,
                      won: rowResults.resultsStatus === "won",
                      lost: rowResults.resultsStatus === "lost",
                      draw: rowResults.resultsStatus === "draw",
                      hover: isHovered,
                    });
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
                            width: showAdvanced ? 180 : 220,
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
                            style={{ width: showAdvanced ? 125 : 165 }}
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
                            className="value variation control-col"
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
                            !metricsAsGuardrails ? (
                              <ChanceToWinColumn
                                stats={stats}
                                baseline={baseline}
                                rowResults={rowResults}
                                showRisk={true}
                                showSuspicious={true}
                                showPercentComplete={showAdvanced}
                                showTimeRemaining={false}
                                className={clsx(
                                  "text-right results-pval",
                                  resultsHighlightClassname
                                )}
                                onPointerMove={onPointerMove}
                                onPointerLeave={onPointerLeave}
                                onClick={onPointerMove}
                              />
                            ) : (
                              <GuardrailResult
                                stats={stats}
                                enoughData={rowResults.enoughData}
                                className={clsx("text-right", {
                                  hover: isHovered,
                                })}
                                onPointerMove={onPointerMove}
                                onPointerLeave={onPointerLeave}
                                onClick={onPointerMove}
                              />
                            )
                          ) : !metricsAsGuardrails ? (
                            <PValueColumn
                              stats={stats}
                              baseline={baseline}
                              rowResults={rowResults}
                              pValueCorrection={pValueCorrection}
                              showRisk={true}
                              showSuspicious={true}
                              showPercentComplete={showAdvanced}
                              showTimeRemaining={false}
                              showUnadjustedPValue={showAdvanced}
                              className={clsx(
                                "text-right results-pval",
                                resultsHighlightClassname
                              )}
                              onPointerMove={onPointerMove}
                              onPointerLeave={onPointerLeave}
                              onClick={onPointerMove}
                            />
                          ) : (
                            <PValueGuardrailResults
                              stats={stats}
                              metric={row.metric}
                              enoughData={rowResults.enoughData}
                              className={clsx("text-right", {
                                hover: isHovered,
                              })}
                              onPointerMove={onPointerMove}
                              onPointerLeave={onPointerLeave}
                              onClick={onPointerMove}
                            />
                          )
                        ) : (
                          <td></td>
                        )}
                        <td>
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
                              rowResults={rowResults}
                              isHovered={isHovered}
                              onPointerMove={(e) =>
                                onPointerMove(e, { x: "element-center" })
                              }
                              onPointerLeave={onPointerLeave}
                              className={resultsHighlightClassname}
                              onClick={onPointerMove}
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
                            showCI={showAdvanced}
                            className={resultsHighlightClassname}
                            onPointerMove={(e) =>
                              onPointerMove(e, { x: "mouse-right" })
                            }
                            onPointerLeave={onPointerLeave}
                            onClick={(e) =>
                              onPointerMove(e, { x: "mouse-right" })
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
                    <td>
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
        This is a 95% credible interval. The true value is more likely to be in
        the thicker parts of the graph.
      </>
    );
  }
  if (statsEngine === "frequentist") {
    return (
      <>
        <p className="mb-0">
          This is a 95% confidence interval. If you re-ran the experiment 100
          times, the true value would be in this range 95% of the time.
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

interface TooltipData {
  metricRow: number;
  variationRow: number;
  metric: MetricInterface;
  variation: ExperimentReportVariation;
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  isGuardrail: boolean;
}
function getTooltipContents(data: TooltipData) {
  return (
    <div className="px-2 py-1">
      <div className="metric-label d-flex align-items-end">
        <span className="h3 mb-0">{data.metric.name}</span>
        <span className="text-muted ml-2">({data.metric.type})</span>
      </div>

      <div
        className="variation-label mt-1 px-2 py-2 rounded"
        style={{ backgroundColor: "rgba(127, 127, 127, 0.05)" }}
      >
        <div
          className={`variation variation${data.variationRow} with-variation-label d-inline-flex align-items-center`}
        >
          <span className="label" style={{ width: 16, height: 16 }}>
            {data.variationRow}
          </span>
          <span className="d-inline-block text-ellipsis font-weight-bold">
            {data.variation.name}
          </span>
        </div>
      </div>

      <div
        className={clsx(
          "results-overview mt-3 px-2 py-2 rounded",
          data.rowResults.resultsStatus
        )}
      >
        <div
          className={clsx(
            "results-change d-flex",
            data.rowResults.directionalStatus
          )}
        >
          <div className="mr-1">% Change:</div>
          <div>
            <span className="expectedArrows">
              {data.rowResults.directionalStatus === "winning" ? (
                <FaArrowUp />
              ) : (
                <FaArrowDown />
              )}
            </span>{" "}
            <span className="expected bold">
              {parseFloat(((data.stats.expected ?? 0) * 100).toFixed(1)) + "%"}{" "}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
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
