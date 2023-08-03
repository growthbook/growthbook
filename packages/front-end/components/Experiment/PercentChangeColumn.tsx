import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import React from "react";
import { RowResults } from "@/services/experiments";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

export default function PercentChangeColumn({
  metric,
  stats,
  rowResults,
  showCI = false,
  className,
  ...otherProps
}: {
  metric: MetricInterface;
  stats: SnapshotMetric;
  rowResults: RowResults;
  showCI?: boolean;
  className?: string;
}) {
  return (
    <td className={clsx("results-change", className)} {...otherProps}>
      {metric && rowResults.enoughData ? (
        <>
          <div
            className={clsx("nowrap change", {
              "text-left": showCI,
              "text-right": !showCI,
            })}
          >
            <span className="expectedArrows">
              {rowResults.directionalStatus === "winning" ? (
                <FaArrowUp />
              ) : (
                <FaArrowDown />
              )}
            </span>{" "}
            <span className="expected bold">
              {parseFloat(((stats.expected ?? 0) * 100).toFixed(1)) + "%"}{" "}
            </span>
          </div>
          {showCI ? (
            <div className="text-right nowrap ci">
              [{percentFormatter.format(stats.ci?.[0] ?? 0)},{" "}
              {percentFormatter.format(stats.ci?.[1] ?? 0)}]
            </div>
          ) : null}
        </>
      ) : null}
    </td>
  );
}
