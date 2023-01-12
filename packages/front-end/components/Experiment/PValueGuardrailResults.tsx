import clsx from "clsx";
import { FC, useMemo } from "react";
import {
  FaCheckCircle,
  FaExclamation,
  FaExclamationTriangle,
  FaQuestionCircle,
} from "react-icons/fa";
import Link from "next/link";
import {
  SnapshotMetric,
  SnapshotVariation,
} from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentReportVariation } from "back-end/types/report";
import { pValueFormatter } from "@/services/experiments";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Tooltip from "../Tooltip/Tooltip";
import MetricTooltipBody from "../Metrics/MetricTooltipBody";
import MetricValueColumn from "./MetricValueColumn";
import { hasEnoughData } from "./GuardrailResult";

type PValueGuardrailResult = {
  stats: SnapshotMetric;
  expectedDirection: boolean;
  statSig: boolean;
  users: number;
  name: string;
  hasEnoughData: boolean;
};

const HeaderResult: FC<{
  metric: MetricInterface;
  results: PValueGuardrailResult[];
}> = ({ metric, results }) => {
  const anyInsufficientData = results.some((r) => !r.hasEnoughData);
  const significantNegativeDirection = results.some(
    (r) => !r.expectedDirection && r.statSig
  );
  const anyNegativeDirection = results.some((r) => !r.expectedDirection);
  const allSignificantPositiveDirection = results.every(
    (r) => r.expectedDirection && r.statSig
  );

  let status = "secondary";

  if (anyInsufficientData) {
    status = "secondary";
  } else if (significantNegativeDirection) {
    status = "danger";
  } else if (anyNegativeDirection) {
    status = "warning";
  } else if (allSignificantPositiveDirection) {
    status = "success";
  }

  return (
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
      <Tooltip body={<MetricTooltipBody metric={metric} />} tipPosition="right">
        <Link href={`/metric/${metric.id}`}>
          <a className="text-dark font-weight-bold">{metric.name}</a>
        </Link>
      </Tooltip>
    </div>
  );
};

const PValueGuardrailResults: FC<{
  data: SnapshotVariation[];
  variations: ExperimentReportVariation[];
  metric: MetricInterface;
}> = ({ data, variations, metric }) => {
  const pValueThreshold = usePValueThreshold();

  const results: PValueGuardrailResult[] = useMemo(() => {
    return variations.map((v, i) => {
      const stats = data[i]?.metrics?.[metric.id];
      const expectedDirection = metric.inverse
        ? stats.expected < 0
        : stats.expected > 0;
      const statSig = stats.pValue < pValueThreshold;
      const users = data[i].users;
      const name = v.name;
      return {
        stats,
        expectedDirection,
        statSig,
        users,
        name,
        hasEnoughData: hasEnoughData(
          stats.value,
          data[0].metrics[metric.id]?.value
        ),
      };
    });
    // eslint-disable-next-line
  }, [variations]);

  return (
    <div className="d-flex flex-column" key={metric.id}>
      <HeaderResult metric={metric} results={results} />

      <div>
        <table
          className={clsx("rounded table table-bordered experiment-compact")}
        >
          <thead>
            <tr>
              <th>Variation</th>
              <th>Value</th>
              <th className="text-center">P-value</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              if (!r.stats) {
                return (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td colSpan={2}>
                      <em>no data yet</em>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={i}>
                  <td>{r.name}</td>

                  <MetricValueColumn
                    metric={metric}
                    stats={r.stats}
                    users={r.users}
                  />

                  {!i ? (
                    <td></td>
                  ) : r.hasEnoughData ? (
                    <td
                      className={clsx("chance result-number align-middle", {
                        won: r.expectedDirection && r.statSig,
                        lost: !r.expectedDirection && r.statSig,
                        warning: !r.expectedDirection && !r.statSig,
                      })}
                    >
                      {r.expectedDirection ? "Better" : "Worse"}{" "}
                      {`(${pValueFormatter(r.stats.pValue)})`}
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

export default PValueGuardrailResults;
