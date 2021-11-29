import React, { FC } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { SnapshotVariation } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import {
  FaCheckCircle,
  FaExclamation,
  FaExclamationTriangle,
  FaQuestionCircle,
} from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import MetricValueColumn from "./MetricValueColumn";

const WARNING_CUTOFF = 0.65;
const DANGER_CUTOFF = 0.9;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function hasEnoughData(value1: number, value2: number): boolean {
  return Math.max(value1, value2) >= 80 && Math.min(value1, value2) >= 20;
}

const GuardrailResults: FC<{
  variations: SnapshotVariation[];
  experiment: ExperimentInterfaceStringDates;
  metric: MetricInterface;
}> = ({ variations, experiment, metric }) => {
  let status: "danger" | "success" | "warning" | "secondary" = "secondary";

  const maxChance = Math.max(
    ...variations.slice(1).map((v) => {
      if (
        !hasEnoughData(
          v.metrics[metric.id]?.value,
          variations[0].metrics[metric.id]?.value
        )
      ) {
        return -1;
      }

      return 1 - v.metrics[metric.id]?.chanceToWin;
    })
  );
  if (maxChance < 0) {
    status = "secondary";
  } else if (maxChance >= DANGER_CUTOFF) {
    status = "danger";
  } else if (maxChance >= WARNING_CUTOFF) {
    status = "warning";
  } else {
    status = "success";
  }

  return (
    <div className="d-flex flex-column" key={metric.id}>
      <div
        className={clsx(
          "d-flex align-items-center guardrail alert m-0",
          `alert-${status}`
        )}
      >
        {status === "success" && <FaCheckCircle className="mr-1" />}
        {status === "warning" && <FaExclamationTriangle className="mr-1" />}
        {status === "danger" && <FaExclamation className="mr-1" />}
        {status === "secondary" && <FaQuestionCircle className="mr-1" />}
        <strong>{metric.name}</strong>
      </div>
      <div>
        <table
          className={clsx("rounded table table-bordered experiment-compact")}
        >
          <thead>
            <tr>
              <th>Variation</th>
              <th>Value</th>
              <th>Chance of Being Worse</th>
            </tr>
          </thead>
          <tbody>
            {experiment.variations.map((v, i) => {
              const stats = variations[i]?.metrics?.[metric.id];
              if (!stats) {
                return (
                  <tr key={i}>
                    <td>{v.name}</td>
                    <td colSpan={2}>
                      <em>no data yet</em>
                    </td>
                  </tr>
                );
              }

              const chance = 1 - (stats.chanceToWin ?? 1);
              return (
                <tr key={i}>
                  <td>{v.name}</td>
                  <MetricValueColumn
                    metric={metric}
                    stats={stats}
                    users={variations[i].users}
                  />
                  {!i ? (
                    <td></td>
                  ) : hasEnoughData(
                      stats.value,
                      variations[0].metrics[metric.id]?.value
                    ) ? (
                    <td
                      className={clsx("chance result-number align-middle", {
                        won: i > 0 && chance >= 0 && chance < WARNING_CUTOFF,
                        lost: i > 0 && chance >= DANGER_CUTOFF,
                        warning:
                          i > 0 &&
                          chance >= WARNING_CUTOFF &&
                          chance < DANGER_CUTOFF,
                      })}
                    >
                      {percentFormatter.format(chance)}
                    </td>
                  ) : (
                    <td>
                      <em>not enough data</em>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
export default GuardrailResults;
