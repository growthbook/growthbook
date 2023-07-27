import clsx from "clsx";
import React, {
  ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FaArrowDown, FaArrowUp, FaQuestionCircle } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentReportVariation } from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import {
  ExperimentTableRow,
  hasEnoughData,
  isStatSig,
  useDomain,
} from "@/services/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBEdit } from "@/components/Icons";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Tooltip from "../Tooltip/Tooltip";
import AlignedGraph from "./AlignedGraph";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraph from "./PercentGraph";
import PValueColumn from "./PValueColumn";

export type ResultsTableProps = {
  id: string;
  variations: ExperimentReportVariation[];
  status: ExperimentStatus;
  isLatestPhase: boolean;
  startDate: string;
  rows: ExperimentTableRow[];
  users?: number[];
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
  fullStats?: boolean;
  riskVariation: number;
  setRiskVariation: (riskVariation: number) => void;
  statsEngine?: StatsEngine;
  pValueCorrection?: PValueCorrection;
  sequentialTestingEnabled?: boolean;
};

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ResultsTable({
  id,
  isLatestPhase,
  status,
  rows,
  users,
  tableRowAxis,
  labelHeader,
  editMetrics,
  variations,
  startDate,
  renderLabelColumn,
  dateCreated,
  fullStats = true,
  hasRisk,
  riskVariation,
  setRiskVariation,
  statsEngine = DEFAULT_STATS_ENGINE,
  pValueCorrection,
  sequentialTestingEnabled = false,
}: ResultsTableProps) {
  const { metricDefaults } = useOrganizationMetricDefaults();
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();

  const tableContainerRef = useRef<HTMLDivElement | undefined>();
  const [graphCellWidth, setGraphCellWidth] = useState(0);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current.clientWidth as number;
    const firstRowCells = tableContainerRef.current?.querySelectorAll(
      "#main-results thead tr:first-child th:not(.graphCell)"
    );
    const expectedArrowsTextWidth = 0; // this is the approximate width of the text "↑ XX.X%" inside <AlignedGraph>
    let totalCellWidth = 0;
    if (firstRowCells) {
      for (let i = 0; i < firstRowCells.length; i++) {
        const cell = firstRowCells[i];
        totalCellWidth += cell.clientWidth;
      }
    }
    const graphWidth = tableWidth - totalCellWidth;
    setGraphCellWidth(graphWidth - expectedArrowsTextWidth);
  }

  useEffect(() => {
    window.addEventListener("resize", onResize);
  }, []);
  useLayoutEffect(() => {
    onResize();
  }, []);

  const orgSettings = useOrgSettings();

  const domain = useDomain(variations, rows);

  const baselineRow = 0;

  // todo: fullStats toggle
  // todo: hasRisk toggle. minimally supported now, but should be more thoughtful
  // todo: some CI info in the % Change column
  // todo: tooltips
  // todo: highlighting, risk (SelectField?), significance, etc

  // todo: StatusBanner?

  return (
    <div ref={tableContainerRef} style={{ minWidth: 1000 }}>
      {users ? (
        <table
          className="experiment-results table table-borderless"
          style={{ width: "auto" }}
        >
          <thead>
            <tr>
              <th style={{ width: 180 }} className="axis-col"></th>
              <th
                style={{ minWidth: 60, paddingBottom: 2 }}
                className="axis-col label"
              >
                Users
              </th>
            </tr>
          </thead>
          <tbody>
            {variations.map((v, i) => (
              <tr key={i}>
                <td
                  className={`variation with-variation-label variation${i} d-inline-flex align-items-center pt-1`}
                  style={{ width: 180 }}
                >
                  <span
                    className="label ml-1"
                    style={{ width: 20, height: 20 }}
                  >
                    {i}
                  </span>
                  <div
                    className="text-ellipsis font-weight-bold"
                    style={{ width: 125 }}
                  >
                    {v.name}
                  </div>
                </td>
                <td className="variation results-user-value align-middle">
                  {numberFormatter.format(users[i] || 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <table
        id="main-results"
        className="experiment-results table-borderless table-sm"
      >
        <thead>
          <tr className="results-top-row">
            <th style={{ width: 180 }} className="axis-col header-label">
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
            <th style={{ width: 100 }} className="axis-col label">
              Baseline
              <span
                className={`variation variation${baselineRow} with-variation-label`}
              >
                <span
                  className="label ml-1"
                  style={{ width: 20, height: 20, marginRight: -20 }}
                >
                  {baselineRow}
                </span>
              </span>
            </th>
            <th style={{ width: 100 }} className="axis-col label">
              Value
            </th>
            <th
              className="axis-col graphCell"
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
            </th>
            <th style={{ width: 150 }} className="axis-col label text-right">
              <Tooltip
                innerClassName={"text-left"}
                body={getPercentChangeTooltip(
                  statsEngine ?? DEFAULT_STATS_ENGINE,
                  hasRisk,
                  !!sequentialTestingEnabled,
                  pValueCorrection ?? null
                )}
              >
                % Change <FaQuestionCircle />
              </Tooltip>
            </th>
            <th style={{ width: 120 }} className="axis-col label text-right">
              {statsEngine === "bayesian" ? (
                <>Chance to Win</>
              ) : sequentialTestingEnabled || pValueCorrection ? (
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
                <th colSpan={3} className="metric-label pb-2">
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
                <th></th>
              </tr>

              {variations.map((v, j) => {
                let skipVariation = false; // todo: use filter
                if (j === 0) {
                  // baseline
                  skipVariation = true;
                }
                if (skipVariation) {
                  return null;
                }
                const stats = row.variations[j] || {
                  value: 0,
                  cr: 0,
                  users: 0,
                };
                const significant =
                  j > 0
                    ? statsEngine === "bayesian"
                      ? (stats.chanceToWin ?? 0) > ciUpper ||
                        (stats.chanceToWin ?? 0) < ciLower
                      : isStatSig(
                          stats.pValueAdjusted ?? stats.pValue ?? 1,
                          pValueThreshold
                        )
                    : false;

                const enoughData = hasEnoughData(
                  baseline,
                  stats,
                  row.metric,
                  metricDefaults
                );

                return (
                  <tr
                    className="results-variation-row align-items-center"
                    key={j}
                  >
                    <td
                      className={`variation with-variation-label variation${j} d-inline-flex align-items-center`}
                      style={{ width: 180 }}
                    >
                      <span
                        className="label ml-1"
                        style={{ width: 20, height: 20 }}
                      >
                        {j}
                      </span>
                      <div
                        className="text-ellipsis font-weight-bold"
                        style={{ width: 125 }}
                      >
                        {v.name}
                      </div>
                    </td>
                    {j === 1 ? (
                      // draw baseline value once, merge rows
                      <MetricValueColumn
                        metric={row.metric}
                        stats={baseline}
                        users={baseline?.users || 0}
                        className="value variation control-col"
                        style={{ backgroundColor: "rgb(127 127 127 / 6%)" }}
                        newUi={true}
                        rowSpan={row.variations.length - 1}
                      />
                    ) : null}
                    <MetricValueColumn
                      metric={row.metric}
                      stats={stats}
                      users={stats?.users || 0}
                      className="value variation"
                      newUi={true}
                    />
                    <td>
                      {j > 0 ? (
                        <PercentGraph
                          barType={
                            statsEngine === "frequentist" ? "pill" : undefined
                          }
                          baseline={baseline}
                          domain={domain}
                          metric={row.metric}
                          stats={stats}
                          id={`${id}_violin_row${i}_var${j}`}
                          graphWidth={graphCellWidth}
                          height={32}
                          newUi={true}
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
                    {j > 0 && row.metric && enoughData ? (
                      <td
                        className={clsx("results-change text-right", {
                          significant: significant,
                          "non-significant": !significant,
                        })}
                      >
                        <span className="expectedArrows">
                          {(stats.expected ?? 0) > 0 ? (
                            <FaArrowUp />
                          ) : (
                            <FaArrowDown />
                          )}
                        </span>{" "}
                        <span className="expected bold">
                          {parseFloat(
                            ((stats.expected ?? 0) * 100).toFixed(1)
                          ) + "%"}{" "}
                        </span>
                      </td>
                    ) : (
                      <td></td>
                    )}
                    {j > 0 ? (
                      statsEngine === "bayesian" ? (
                        <ChanceToWinColumn
                          baseline={baseline}
                          stats={stats}
                          status={status}
                          isLatestPhase={isLatestPhase}
                          startDate={startDate}
                          metric={row.metric}
                          snapshotDate={dateCreated}
                          className="text-right"
                          newUi={true}
                        />
                      ) : (
                        <PValueColumn
                          baseline={baseline}
                          stats={stats}
                          status={status}
                          isLatestPhase={isLatestPhase}
                          startDate={startDate}
                          metric={row.metric}
                          snapshotDate={dateCreated}
                          pValueCorrection={pValueCorrection}
                          className="text-right"
                          newUi={true}
                        />
                      )
                    ) : (
                      <td></td>
                    )}
                  </tr>
                );
              })}

              {/*spacer row*/}
              <tr className="results-label-row" style={{ lineHeight: "1px" }}>
                <td></td>
                <td></td>
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
                <td></td>
              </tr>
            </tbody>
          );
        })}
      </table>
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
