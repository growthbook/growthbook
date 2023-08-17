import React, { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { FaCheck, FaExclamation, FaExclamationTriangle } from "react-icons/fa";
import clsx from "clsx";

export const WARNING_CUTOFF = 0.65;
export const DANGER_CUTOFF = 0.9;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function getGuardrailStatus(
  chance: number
): "ok" | "warning" | "danger" | "non-significant" {
  let status: "ok" | "warning" | "danger" | "non-significant" =
    "non-significant";
  if (chance >= 0 && chance < WARNING_CUTOFF) {
    status = "ok";
  } else if (chance >= WARNING_CUTOFF && chance < DANGER_CUTOFF) {
    status = "warning";
  } else if (chance >= DANGER_CUTOFF) {
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
  enoughData: boolean;
  className?: string;
}

const GuardrailResult = ({
  stats,
  enoughData,
  className,
  ...otherProps
}: Props) => {
  const chance = 1 - (stats.chanceToWin ?? 1);
  const status = !enoughData ? "" : getGuardrailStatus(chance);

  return (
    <td
      className={clsx("guardrail result-number", className, {
        "non-significant": !enoughData,
      })}
      {...otherProps}
    >
      <div className="variation">
        {stats && enoughData ? (
          <>
            <span style={{ fontSize: 16 }}>
              {status === "ok" && <FaCheck className="mr-1" />}
              {status === "warning" && (
                <FaExclamationTriangle className="mr-1" />
              )}
              {status === "danger" && <FaExclamation className="mr-1" />}
            </span>
            <div className="d-inline-block ml-2" style={{ width: 50 }}>
              {percentFormatter.format(chance)}
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
export default GuardrailResult;
