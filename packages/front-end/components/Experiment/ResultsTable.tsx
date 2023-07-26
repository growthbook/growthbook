import clsx from "clsx";
import React, {ReactElement, useEffect, useLayoutEffect, useRef, useState} from "react";
import {FaArrowDown, FaArrowUp, FaQuestionCircle} from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentReportVariation } from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import {ExperimentTableRow, isStatSig, useDomain} from "@/services/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import Tooltip from "../Tooltip/Tooltip";
import SelectField from "../Forms/SelectField";
import AlignedGraph from "./AlignedGraph";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraph from "./PercentGraph";
import RiskColumn from "./RiskColumn";
import PValueColumn from "./PValueColumn";
import {GBEdit} from "@/components/Icons";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";

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
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphCellWidth, setGraphCellWidth] = useState(0);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current.clientWidth as number;
    const firstRowCells = tableContainerRef.current?.querySelectorAll("thead tr:first-child th:not(.graphCell)");
    const expectedArrowsTextWidth = 0; // this is the approximate width of the text "↑ XX.X%" inside <AlignedGraph>
    let totalCellWidth = 0;
    if (firstRowCells) {
      for (let i = 0; i < firstRowCells.length; i++) {
        const cell = firstRowCells[i];
        totalCellWidth += cell.clientWidth;
      }
    }
    const graphWidth = tableWidth - totalCellWidth;
    console.log({totalCellWidth, graphWidth, tableWidth,  cells: firstRowCells.length})
    setGraphCellWidth(graphWidth - expectedArrowsTextWidth);
  }

  useEffect(() => {
    window.addEventListener("resize", onResize);
  }, []);
  useLayoutEffect(() => {
    onResize();
  }, [tableContainerRef.current]);

  const orgSettings = useOrgSettings();

  const domain = useDomain(variations, rows);

  return (
    <div ref={tableContainerRef}>
      <table className="experiment-results table-borderless table-sm">
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
            ): null}
          </th>
          <th style={{ width: 100 }} className="axis-col label">Value</th>
          <th className="axis-col graphCell" style={{ maxWidth: graphCellWidth }}>
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
          <th style={{ width: 120 }} className="axis-col label text-right">% Change</th>
        </tr>
      </thead>

      {rows.map((row, i) => {
        const baseline = row.variations[0] || {
          value: 0,
          cr: 0,
          users: 0,
        };

        return (
          <tbody
            className="results-group-row" key={i}
            style={{ backgroundColor: i%2 === 1 ? "rgb(127 127 127 / 8%)" : "transparent" }}
          >
            <tr className="results-label-row">
              <th colSpan={2} className="metric-label pb-2">
                {row.label}
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
              const skipVariation = false; // todo: use filter
              if (skipVariation) {
                return null;
              }
              const stats = row.variations[j] || {
                value: 0,
                cr: 0,
                users: 0,
              };
              let significant = j > 0 ? (
                statsEngine === "bayesian"
                  ? (stats.chanceToWin ?? 0) > ciUpper || (stats.chanceToWin ?? 0) < ciLower
                  : isStatSig(
                    stats.pValueAdjusted ?? stats.pValue ?? 1,
                    pValueThreshold
                  )
              ) : false;

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
                  {/*todo: put "users" in its own row*/}
                  {(users && j<0) ? (
                    <td className="results-user-value">
                      {numberFormatter.format(users[j] || 0)}
                    </td>
                  ) : (
                    <MetricValueColumn
                      metric={row.metric}
                      stats={stats}
                      users={stats?.users || 0}
                      className="value variation"
                      newUi={true}
                    />
                  )}
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
                  <td className={clsx(
                    "results-change text-right",
                    {
                      "significant": significant,
                      "non-significant": !significant,
                    }
                  )}>
                    <span className="expectedArrows">
                      {(stats.expected ?? 0) > 0 ? <FaArrowUp /> : <FaArrowDown />}
                    </span>{" "}
                    <span className="expected bold">
                      {parseFloat(((stats.expected ?? 0) * 100).toFixed(1)) + "%"}{" "}
                    </span>
                  </td>
                </tr>
              );
            })}

            {/*spacer row*/}
            <tr className="results-label-row" style={{lineHeight: "1px"}}>
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
            </tr>
          </tbody>
        );
      })}
    </table>
    </div>
  );

  return (
    <table
      className={`table experiment-compact aligned-graph`}
      style={{
        width: fullStats ? "100%" : "auto",
        maxWidth: "100%",
      }}
    >
      <thead>
        <tr>
          <th
            rowSpan={2}
            className="metric head-last-row"
            style={{ minWidth: 125 }}
          >
            {labelHeader}
          </th>
          {hasRisk && fullStats && (
            <th
              rowSpan={2}
              className="metric head-last-row"
              style={{ maxWidth: 155, minWidth: 125 }}
            >
              Risk of Choosing&nbsp;
              <Tooltip body="How much you are likely to lose if you choose this variation and it's actually worse">
                <FaQuestionCircle />
              </Tooltip>
              <div className="mt-1">
                <SelectField
                  className="small"
                  style={{ maxWidth: 150 }}
                  value={riskVariation + ""}
                  onChange={(v) => {
                    setRiskVariation(parseInt(v));
                  }}
                  options={variations.map((v, i) => ({
                    value: i + "",
                    label: `${i}: ${v.name}`,
                  }))}
                />
              </div>
            </th>
          )}
          {variations.map((v, i) => (
            <th
              colSpan={i ? (fullStats ? 3 : 2) : 1}
              className={`value variation with-variation-label variation${i} pb-2`}
              key={i}
              style={{ whiteSpace: i == 0 ? "nowrap" : "initial" }}
            >
              <span className="label">{i}</span>
              <span className="name">{v.name}</span>
            </th>
          ))}
        </tr>
        <tr>
          {variations.map((v, i) => (
            <React.Fragment key={i}>
              <th
                className={clsx(
                  "value pt-2",
                  `variation${i} head-last-row text-center`
                )}
              >
                Value
              </th>
              {i > 0 && fullStats && (
                <th
                  className={`variation${i} head-last-row text-center pt-2`}
                  style={{ minWidth: 110 }}
                >
                  {statsEngine === "frequentist" ? (
                    <>
                      P-value
                      {(sequentialTestingEnabled || pValueCorrection) && (
                        <Tooltip
                          innerClassName="text-left"
                          body={
                            <>
                              {sequentialTestingEnabled && (
                                <div className={pValueCorrection ? "mb-3" : ""}>
                                  Sequential testing is enabled. These are
                                  &apos;always valid p-values&apos; and robust
                                  to peeking. They have a slightly different
                                  interpretation to normal p-values and can
                                  often be 1.000. Nonetheless, the
                                  interpretation remains that the result is
                                  still statistically significant if it drops
                                  below your threshold (
                                  {orgSettings.pValueThreshold ?? 0.05}).
                                </div>
                              )}
                              {pValueCorrection && (
                                <div>
                                  The p-values presented below are adjusted for
                                  multiple comparisons using the{" "}
                                  {pValueCorrection} method. P-values were
                                  adjusted across tests for
                                  {tableRowAxis === "dimension"
                                    ? "all dimension values, non-guardrail metrics, and variations"
                                    : "all non-guardrail metrics and variations"}
                                  . The unadjusted p-values are returned in
                                  parentheses.
                                </div>
                              )}
                            </>
                          }
                        >
                          {" "}
                          <FaQuestionCircle />
                        </Tooltip>
                      )}
                    </>
                  ) : (
                    "Chance to Beat Control"
                  )}
                </th>
              )}
              {i > 0 && (
                <th className={`variation${i} head-last-row text-center pt-2`}>
                  Percent Change{" "}
                  {fullStats && (
                    <>
                      {hasRisk && statsEngine === "bayesian" && (
                        <Tooltip
                          innerClassName="text-left"
                          body="This is a 95% credible interval. The true value is more likely to be in the thicker parts of the graph."
                        >
                          <FaQuestionCircle />
                        </Tooltip>
                      )}
                      {statsEngine === "frequentist" && (
                        <Tooltip
                          innerClassName="text-left"
                          body={
                            <>
                              <p className="mb-0">
                                This is a 95% confidence interval. If you re-ran
                                the experiment 100 times, the true value would
                                be in this range 95% of the time.
                              </p>
                              {sequentialTestingEnabled && (
                                <p className="mt-4 mb-0">
                                  Because sequential testing is enabled, these
                                  confidence intervals are valid no matter how
                                  many times you analyze (or peek at) this
                                  experiment as it runs.
                                </p>
                              )}
                              {pValueCorrection && (
                                <p className="mt-4 mb-0">
                                  These confidence intervals are not adjusted
                                  for multiple comparisons as the multiple
                                  comparisons adjustments GrowthBook implements
                                  only have associated adjusted p-values, not
                                  confidence intervals.
                                </p>
                              )}
                            </>
                          }
                        >
                          <FaQuestionCircle />
                        </Tooltip>
                      )}
                    </>
                  )}
                </th>
              )}
            </React.Fragment>
          ))}
        </tr>
        <tr>
          <th className="head-bottom-border sticky"></th>
          {hasRisk && fullStats && (
            <th className="empty-td head-bottom-border"></th>
          )}
          {variations.map((v, i) => (
            <th
              key={i}
              className={`head-bottom-border variation variation${i} with-variation-fill`}
              colSpan={i ? (fullStats ? 3 : 2) : 1}
            ></th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>{users ? "Users" : ""}</th>
          {hasRisk && fullStats && <th className="empty-td"></th>}
          {variations.map((v, i) => (
            <React.Fragment key={i}>
              <td className="value">
                {users ? numberFormatter.format(users[i] || 0) : ""}
              </td>
              {i > 0 && (
                <>
                  {fullStats && <td className="empty-td"></td>}
                  <td className="p-0">
                    <div>
                      {fullStats && (
                        <AlignedGraph
                          id={`${id}_axis_var${i}`}
                          domain={domain}
                          significant={true}
                          showAxis={true}
                          axisOnly={true}
                          height={45}
                          newUi={true}
                        />
                      )}
                    </div>
                  </td>
                </>
              )}
            </React.Fragment>
          ))}
        </tr>

        {rows.map((row, ind) => {
          const baseline = row.variations[0] || {
            value: 0,
            cr: 0,
            users: 0,
          };

          return (
            <tr
              key={row.label}
              className={clsx(
                "metricrow",
                {
                  nodata: !baseline?.value,
                },
                row.rowClass
              )}
            >
              <th className="metricname">
                {renderLabelColumn(row.label, row.metric, row)}
              </th>
              {hasRisk && fullStats && (
                <RiskColumn row={row} riskVariation={riskVariation} />
              )}
              {variations.map((v, i) => {
                const stats = row.variations[i] || {
                  value: 0,
                  cr: 0,
                  users: 0,
                };
                return (
                  <React.Fragment key={i}>
                    <MetricValueColumn
                      metric={row.metric}
                      stats={stats}
                      users={stats?.users || 0}
                      className="value variation"
                    />
                    {i > 0 &&
                      fullStats &&
                      (statsEngine === "frequentist" ? (
                        <PValueColumn
                          baseline={baseline}
                          stats={stats}
                          status={status}
                          isLatestPhase={isLatestPhase}
                          startDate={startDate}
                          metric={row.metric}
                          snapshotDate={dateCreated}
                          pValueCorrection={pValueCorrection}
                        />
                      ) : (
                        <ChanceToWinColumn
                          baseline={baseline}
                          stats={stats}
                          status={status}
                          isLatestPhase={isLatestPhase}
                          startDate={startDate}
                          metric={row.metric}
                          snapshotDate={dateCreated}
                        />
                      ))}
                    {i > 0 &&
                      (fullStats ? (
                        <PercentGraphColumn
                          barType={
                            statsEngine === "frequentist" ? "pill" : undefined
                          }
                          baseline={baseline}
                          domain={domain}
                          metric={row.metric}
                          stats={stats}
                          id={`${id}_violin_row${ind}_var${i}`}
                        />
                      ) : (
                        <td className="align-middle">
                          {percentFormatter.format(stats?.expected || 0)}
                        </td>
                      ))}
                  </React.Fragment>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
