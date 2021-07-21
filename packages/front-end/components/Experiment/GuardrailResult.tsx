import React, { FC } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { SnapshotVariation } from "back-end/types/experiment-snapshot";
import { useState } from "react";
import clsx from "clsx";
import {
  FaAngleDown,
  FaAngleRight,
  FaCheckCircle,
  FaExclamation,
  FaExclamationTriangle,
  FaMinusCircle,
  FaQuestionCircle,
} from "react-icons/fa";
import { MetricInterface } from "../../../back-end/types/metric";
import { formatConversionRate } from "../../services/metrics";

const WARNING_CUTOFF = 0.7;
const DANGER_CUTOFF = 0.85;
const SUCCESS_CUTOFF = 0.5;

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const GuardrailResults: FC<{
  variations: SnapshotVariation[];
  experiment: ExperimentInterfaceStringDates;
  metric: MetricInterface;
}> = ({ variations, experiment, metric }) => {
  let status: "secondary" | "danger" | "success" | "warning" | "light" =
    "secondary";

  const maxChance = Math.max(
    ...variations.slice(1).map((v) => {
      return 1 - (v.metrics[metric.id]?.chanceToWin || 2);
    })
  );
  if (maxChance < 0) {
    status = "light";
  } else if (maxChance >= DANGER_CUTOFF) {
    status = "danger";
  } else if (maxChance >= WARNING_CUTOFF) {
    status = "warning";
  } else if (maxChance <= SUCCESS_CUTOFF) {
    status = "success";
  }

  const [open, setOpen] = useState(
    status !== "success" && status !== "secondary"
  );

  return (
    <div className="d-flex flex-column" key={metric.id}>
      <div
        className={clsx(
          "cursor-pointer d-flex align-items-center guardrail alert m-0",
          `alert-${status}`,
          {
            border: status === "light",
          }
        )}
        onClick={() => setOpen(!open)}
      >
        {status === "success" && <FaCheckCircle className="mr-1" />}
        {status === "warning" && <FaExclamationTriangle className="mr-1" />}
        {status === "danger" && <FaExclamation className="mr-1" />}
        {status === "secondary" && <FaMinusCircle className="mr-1" />}
        {status === "light" && <FaQuestionCircle className="mr-1" />}
        <strong>{metric.name}</strong>
        {open ? (
          <FaAngleDown className="ml-auto" />
        ) : (
          <FaAngleRight className="ml-auto" />
        )}
      </div>
      <div
        style={{
          maxHeight: open ? 300 : 0,
          overflow: "hidden",
          transition: "max-height 0.3s",
        }}
      >
        {maxChance > 0 ? (
          <table
            className={clsx("rounded table table-bordered experiment-compact")}
          >
            <thead>
              <tr>
                <th>Variation</th>
                <th>Value</th>
                <th>Probability of Losing</th>
              </tr>
            </thead>
            <tbody>
              {experiment.variations.map((v, i) => {
                const stats = variations[i].metrics[metric.id];
                if (!stats) return;

                const chance = 1 - (stats.chanceToWin || 1);
                return (
                  <tr key={i}>
                    <td>{v.name}</td>
                    <td>
                      <div className="result-number">
                        {formatConversionRate(metric.type, stats.cr)}
                      </div>
                      <div>
                        <small className="text-muted">
                          <em>
                            {numberFormatter.format(stats.value)}
                            &nbsp;/&nbsp;
                            {numberFormatter.format(
                              stats.users || variations[i].users
                            )}
                          </em>
                        </small>
                      </div>
                    </td>
                    <td
                      className={clsx("chance result-number align-middle", {
                        won: i > 0 && chance <= SUCCESS_CUTOFF,
                        lost: i > 0 && chance >= DANGER_CUTOFF,
                        warning:
                          i > 0 &&
                          chance >= WARNING_CUTOFF &&
                          chance < DANGER_CUTOFF,
                      })}
                    >
                      {i ? percentFormatter.format(chance) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="border py-2 px-3">
            <em>No data yet</em>
          </div>
        )}
      </div>
    </div>
  );
};
export default GuardrailResults;
