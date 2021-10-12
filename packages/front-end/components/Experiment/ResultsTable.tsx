import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import clsx from "clsx";
import React, { ReactElement } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { MetricInterface } from "../../../back-end/types/metric";
import { ExperimentTableRow, useDomain } from "../../services/experiments";
import Tooltip from "../Tooltip";
import AlignedGraph from "./AlignedGraph";
import ChanceToWinColumn from "./ChanceToWinColumn";
import MetricValueColumn from "./MetricValueColumn";
import PercentGraphColumn from "./PercentGraphColumn";
import RiskColumn from "./RiskColumn";

export type ResultsTableProps = {
  id: string;
  experiment: ExperimentInterfaceStringDates;
  rows: ExperimentTableRow[];
  users?: number[];
  labelHeader: string;
  renderLabelColumn: (
    label: string,
    metric: MetricInterface
  ) => string | ReactElement;
  phase: number;
  dateCreated: Date;
  hasRisk: boolean;
  riskVariation: number;
  setRiskVariation: (riskVariation: number) => void;
};

const numberFormatter = new Intl.NumberFormat();

export default function ResultsTable({
  id,
  experiment,
  rows,
  labelHeader,
  users,
  renderLabelColumn,
  phase,
  dateCreated,
  hasRisk,
  riskVariation,
  setRiskVariation,
}: ResultsTableProps) {
  const domain = useDomain(experiment, rows);

  return (
    <table className={`table experiment-compact aligned-graph`}>
      <thead>
        <tr>
          <th rowSpan={2} className="metric" style={{ minWidth: 125 }}>
            {labelHeader}
          </th>
          {hasRisk && (
            <th
              rowSpan={2}
              className="metric"
              style={{ maxWidth: 142, minWidth: 125 }}
            >
              Risk of Choosing&nbsp;
              <Tooltip text="How much you are likely to lose if you choose this variation and it's actually worse">
                <FaQuestionCircle />
              </Tooltip>
              <div className="mt-1">
                <select
                  className="form-control form-control-sm"
                  style={{ maxWidth: 150 }}
                  value={riskVariation}
                  onChange={(e) => {
                    setRiskVariation(parseInt(e.target.value));
                  }}
                >
                  {experiment.variations.map((v, i) => (
                    <option key={v.name} value={i}>
                      {i}: {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </th>
          )}
          {experiment.variations.map((v, i) => (
            <th colSpan={i ? 3 : 1} className="value" key={i}>
              <span className="text-muted font-weight-normal">{i}:</span>
              &nbsp;{v.name}
            </th>
          ))}
        </tr>
        <tr>
          {experiment.variations.map((v, i) => (
            <React.Fragment key={i}>
              <th className={clsx("value", `variation${i} text-center`)}>
                Value
              </th>
              {i > 0 && (
                <th
                  className={`variation${i} text-center`}
                  style={{ minWidth: 110 }}
                >
                  Chance to Beat Control
                </th>
              )}
              {i > 0 && (
                <th className={`variation${i} text-center`}>
                  Percent Change{" "}
                  {hasRisk && (
                    <Tooltip text="The true value is more likely to be in the thicker parts of the graph">
                      <FaQuestionCircle />
                    </Tooltip>
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
          {hasRisk && <th className="empty-td"></th>}
          {experiment.variations.map((v, i) => (
            <React.Fragment key={i}>
              <td className="value">
                {users ? numberFormatter.format(users[i] || 0) : ""}
              </td>
              {i > 0 && (
                <>
                  <td className="empty-td"></td>
                  <td className="p-0">
                    <div>
                      <AlignedGraph
                        id={`${id}_axis_var${i}`}
                        domain={domain}
                        significant={true}
                        showAxis={true}
                        axisOnly={true}
                        height={45}
                      />
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
                {renderLabelColumn(row.label, row.metric)}
              </th>
              {hasRisk && (
                <RiskColumn row={row} riskVariation={riskVariation} />
              )}
              {experiment.variations.map((v, i) => {
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
                    {i > 0 && (
                      <ChanceToWinColumn
                        baseline={baseline}
                        stats={stats}
                        experiment={experiment}
                        metric={row.metric}
                        phase={phase}
                        snapshotDate={dateCreated}
                      />
                    )}
                    {i > 0 && (
                      <PercentGraphColumn
                        baseline={baseline}
                        domain={domain}
                        metric={row.metric}
                        stats={stats}
                        id={`${id}_violin_row${ind}_var${i}`}
                      />
                    )}
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
