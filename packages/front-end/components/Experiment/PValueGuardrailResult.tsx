import React, { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import {
  FaCheck,
  FaExclamation,
  FaExclamationTriangle,
  FaQuestion,
} from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import clsx from "clsx";
import {
  isExpectedDirection,
  isStatSig,
  pValueFormatter,
} from "@/services/experiments";
import usePValueThreshold from "@/hooks/usePValueThreshold";

export function getPValueGuardrailStatus(
  expectedDirection: boolean,
  statSig: boolean
): "ok" | "warning" | "danger" | "non-significant" {
  let status: "ok" | "warning" | "danger" | "non-significant" =
    "non-significant";
  if (expectedDirection && statSig) {
    status = "ok";
  } else if (!expectedDirection && !statSig) {
    status = "warning";
  } else if (!expectedDirection && statSig) {
    status = "danger";
  }
  return status;
}

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  stats: SnapshotMetric;
  metric: MetricInterface;
  enoughData: boolean;
  className?: string;
}

const PValueGuardrailResults = ({
  stats,
  metric,
  enoughData,
  className,
  ...otherProps
}: Props) => {
  const pValueThreshold = usePValueThreshold();

  const expectedDirection = isExpectedDirection(stats, metric);
  // note: do not use pValueAdjusted for guardrails
  const statSig = isStatSig(stats?.pValue ?? 1, pValueThreshold);
  const status = !enoughData
    ? ""
    : getPValueGuardrailStatus(expectedDirection, statSig);

  return (
    <td
      className={clsx("guardrail result-number", className, {
        "non-significant": !enoughData,
      })}
      {...otherProps}
    >
      <div
        className={`variation ${status} d-flex justify-content-end align-items-center`}
      >
        {stats && enoughData ? (
          <>
            <span style={{ fontSize: 16 }}>
              {status === "ok" && <FaCheck className="mr-1" />}
              {status === "warning" && (
                <FaExclamationTriangle className="mr-1" />
              )}
              {status === "danger" && <FaExclamation className="mr-1" />}
              {status === "non-significant" && <FaQuestion className="mr-1" />}
            </span>
            <div
              className="d-inline-block ml-2"
              style={{ width: 50, lineHeight: "14px" }}
            >
              {pValueFormatter(stats.pValue ?? 1)}
            </div>
          </>
        ) : (
          <span
            className="font-weight-normal"
            style={{ fontSize: 10.5, marginLeft: -20 }}
          >
            not enough data
          </span>
        )}
      </div>
    </td>
  );
};
export default PValueGuardrailResults;
