import React, { FC } from "react";
import { SnapshotVariation } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import {
  FaCheckCircle,
  FaExclamation,
  FaExclamationTriangle,
  FaQuestionCircle,
} from "react-icons/fa";
import { ExperimentReportVariation } from "back-end/types/report";
import Link from "next/link";
import { ExperimentMetricInterface, getMetricLink } from "shared/experiments";
import Tooltip from "../Tooltip/Tooltip";
import MetricTooltipBody from "../Metrics/MetricTooltipBody";
import MetricValueColumn from "./MetricValueColumn";

const WARNING_CUTOFF = 0.65;
const DANGER_CUTOFF = 0.9;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function hasEnoughData(value1: number, value2: number): boolean {
  return Math.max(value1, value2) >= 80 && Math.min(value1, value2) >= 20;
}

const GuardrailResults: FC<{
  data: SnapshotVariation[];
  variations: ExperimentReportVariation[];
  metric: ExperimentMetricInterface;
}> = ({ data, variations, metric }) => {
  let status: "danger" | "success" | "warning" | "secondary" = "secondary";

  const maxChance = Math.max(
    ...data.slice(1).map((v) => {
      if (
        !hasEnoughData(
          v.metrics[metric.id]?.value,
          data[0].metrics[metric.id]?.value
        )
      ) {
        return -1;
      }

      return 1 - (v.metrics[metric.id]?.chanceToWin ?? 0);
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
          "d-flex align-items-center guardrail m-0 p-2",
          `alert-${status}`
        )}
      >
        {status === "success" && <FaCheckCircle className="mr-1" />}
        {status === "warning" && <FaExclamationTriangle className="mr-1" />}
        {status === "danger" && <FaExclamation className="mr-1" />}
        {status === "secondary" && <FaQuestionCircle className="mr-1" />}
        <Tooltip
          body={<MetricTooltipBody metric={metric} />}
          tipPosition="right"
        >
          <Link href={getMetricLink(metric.id)}>
            <a className="text-black-50 font-weight-bold">{metric.name}</a>
          </Link>
        </Tooltip>
      </div>
      <div>
        <table className={clsx("table experiment-compact small-padding mb-1")}>
          <thead>
            <tr>
              <th>Variation</th>
              <th>Value</th>
              <th className="text-center">Chance of Being Worse</th>
            </tr>
          </thead>
          <tbody>
            {variations.map((v, i) => {
              const stats = data[i]?.metrics?.[metric.id];
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
                  <th
                    className={`variation with-variation-right-shadow variation${i} font-weight-normal`}
                  >
                    <span className="name">{v.name}</span>
                  </th>
                  <MetricValueColumn
                    metric={metric}
                    stats={stats}
                    users={data[i].users}
                  />
                  {!i ? (
                    <td></td>
                  ) : hasEnoughData(
                      stats.value,
                      data[0].metrics[metric.id]?.value
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
                    <td className="text-center">
                      <em className="text-muted">not enough data</em>
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
