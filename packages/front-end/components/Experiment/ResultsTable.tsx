import clsx from "clsx";
import React, { ReactElement } from "react";
import { FaQuestionCircle, FaTimes } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentReportVariation } from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import { StatsEngine } from "back-end/types/stats";
import { ExperimentTableRow, useDomain } from "@/services/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBCuped } from "@/components/Icons";
import Tooltip from "../Tooltip/Tooltip";
import SelectField from "../Forms/SelectField";
import AlignedGraph from "./AlignedGraph";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraphColumn from "./PercentGraphColumn";
import RiskColumn from "./RiskColumn";
import PValueColumn from "./PValueColumn";

export type ResultsTableProps = {
  id: string;
  variations: ExperimentReportVariation[];
  status: ExperimentStatus;
  isLatestPhase: boolean;
  startDate: string;
  rows: ExperimentTableRow[];
  users?: number[];
  labelHeader: string;
  renderLabelColumn: (
    label: string,
    metric: MetricInterface
  ) => string | ReactElement;
  dateCreated: Date;
  hasRisk: boolean;
  fullStats?: boolean;
  riskVariation: number;
  setRiskVariation: (riskVariation: number) => void;
  statsEngine?: StatsEngine;
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
  labelHeader,
  users,
  variations,
  startDate,
  renderLabelColumn,
  dateCreated,
  fullStats = true,
  hasRisk,
  riskVariation,
  setRiskVariation,
  statsEngine: _statsEngine,
}: ResultsTableProps) {
  const domain = useDomain(variations, rows);
  const orgSettings = useOrgSettings();
  const statsEngine = _statsEngine ? _statsEngine : orgSettings.statsEngine;

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
          <th rowSpan={2} className="metric" style={{ minWidth: 125 }}>
            {labelHeader}
          </th>
          {hasRisk && fullStats && (
            <th
              rowSpan={2}
              className="metric"
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
            <th colSpan={i ? (fullStats ? 3 : 2) : 1} className="value" key={i}>
              <span className="text-muted font-weight-normal">{i}:</span>
              &nbsp;{v.name}
            </th>
          ))}
        </tr>
        <tr>
          {variations.map((v, i) => (
            <React.Fragment key={i}>
              <th className={clsx("value", `variation${i} text-center`)}>
                Value
              </th>
              {i > 0 && fullStats && (
                <th
                  className={`variation${i} text-center`}
                  style={{ minWidth: 110 }}
                >
                  {statsEngine === "frequentist"
                    ? "P-value"
                    : "Chance to Beat Control"}
                </th>
              )}
              {i > 0 && (
                <th className={`variation${i} text-center`}>
                  Percent Change{" "}
                  {fullStats && (
                    <>
                      {hasRisk && statsEngine === "bayesian" && (
                        <Tooltip body="This is a 95% credible interval. The true value is more likely to be in the thicker parts of the graph.">
                          <FaQuestionCircle />
                        </Tooltip>
                      )}
                      {statsEngine === "frequentist" && (
                        <Tooltip body="This is a 95% confidence interval. If you re-ran the experiment 100 times, the true value would be in this range 95% of the time.">
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
                {row?.regressionAdjustmentStatus
                  ?.regressionAdjustmentEnabled && (
                  <span className="mr-1">
                    <Tooltip body="CUPED enabled">
                      <GBCuped />
                    </Tooltip>
                  </span>
                )}
                {row?.regressionAdjustmentStatus
                  ?.regressionAdjustmentEnabled === false &&
                  row?.regressionAdjustmentStatus?.reason && (
                    <Tooltip
                      body={`CUPED disabled: ${row?.regressionAdjustmentStatus?.reason}`}
                    >
                      <span className="mr-1 position-relative">
                        <GBCuped className="position-absolute" />
                        <FaTimes
                          className="position-absolute"
                          color="#ff0000"
                          style={{ transform: "scale(0.7)", top: 0, right: -7 }}
                        />
                      </span>
                    </Tooltip>
                  )}
                {renderLabelColumn(row.label, row.metric)}
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
                            statsEngine === "frequentist" ? "pill" : null
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
