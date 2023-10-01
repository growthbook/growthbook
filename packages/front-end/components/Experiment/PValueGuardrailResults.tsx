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
import { ExperimentReportVariation } from "back-end/types/report";
import { ExperimentMetricInterface, getMetricLink } from "shared/experiments";
import {
  isExpectedDirection,
  isStatSig,
  pValueFormatter,
} from "@/services/experiments";
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
  metric: ExperimentMetricInterface;
  results: PValueGuardrailResult[];
}> = ({ metric, results }) => {
  // remove control for determining header
  const newResults = results.slice(1);
  const anyInsufficientData = newResults.some((r) => !r.hasEnoughData);
  const significantNegativeDirection = newResults.some(
    (r) => !r.expectedDirection && r.statSig
  );
  const anyNegativeDirection = newResults.some((r) => !r.expectedDirection);
  const allSignificantPositiveDirection = newResults.every(
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
        "d-flex align-items-center guardrail m-0 p-2",
        `alert-${status}`
      )}
    >
      {status === "success" && <FaCheckCircle className="mr-1" />}
      {status === "warning" && <FaExclamationTriangle className="mr-1" />}
      {status === "danger" && <FaExclamation className="mr-1" />}
      {status === "secondary" && <FaQuestionCircle className="mr-1" />}
      <Tooltip body={<MetricTooltipBody metric={metric} />} tipPosition="right">
        <Link href={getMetricLink(metric.id)}>
          <a className="text-black-50 font-weight-bold">{metric.name}</a>
        </Link>
      </Tooltip>
    </div>
  );
};

const PValueGuardrailResults: FC<{
  data: SnapshotVariation[];
  variations: ExperimentReportVariation[];
  metric: ExperimentMetricInterface;
}> = ({ data, variations, metric }) => {
  const pValueThreshold = usePValueThreshold();

  const results: PValueGuardrailResult[] = useMemo(() => {
    return variations.map((v, i) => {
      const stats = data[i]?.metrics?.[metric.id];
      const expectedDirection = isExpectedDirection(stats, metric);
      const statSig = isStatSig(stats?.pValue ?? 1, pValueThreshold);
      const users = data[i].users;
      const name = v.name;
      return {
        stats,
        expectedDirection,
        statSig,
        users,
        name,
        hasEnoughData: hasEnoughData(
          stats?.value ?? 0,
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
        <table className={clsx("table experiment-compact small-padding mb-1")}>
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
                  <th
                    className={`variation with-variation-right-shadow variation${i} font-weight-normal`}
                  >
                    <span className="name">{r.name}</span>
                  </th>

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
                      {`(${
                        r.stats?.pValue !== undefined
                          ? pValueFormatter(r.stats?.pValue)
                          : "P-value missing"
                      })`}
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

export default PValueGuardrailResults;
