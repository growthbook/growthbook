import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import React, { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { StatsEngine } from "back-end/types/stats";
import { RowResults } from "@/services/experiments";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  metric: MetricInterface;
  stats: SnapshotMetric;
  rowResults: RowResults;
  statsEngine: StatsEngine;
  showCI?: boolean;
  className?: string;
}

export default function PercentChangeColumn({
  metric,
  stats,
  rowResults,
  statsEngine,
  showCI = false,
  className,
  ...otherProps
}: Props) {
  return (
    <>
      {metric && rowResults.enoughData ? (
        <td className={clsx("results-change", className)} {...otherProps}>
          <div
            className={clsx("nowrap change", {
              "text-left": showCI,
              "text-right": !showCI,
            })}
          >
            <span className="expectedArrows">
              {(rowResults.directionalStatus === "winning" &&
                !metric.inverse) ||
              (rowResults.directionalStatus === "losing" && metric.inverse) ? (
                <FaArrowUp />
              ) : (
                <FaArrowDown />
              )}
            </span>{" "}
            <span className="expected">
              {parseFloat(((stats.expected ?? 0) * 100).toFixed(1)) + "%"}{" "}
            </span>
            {statsEngine === "frequentist" && showCI ? (
              <span className="plusminus ml-1">
                {"±" +
                  parseFloat(
                    (
                      Math.abs((stats.expected ?? 0) - (stats.ci?.[0] ?? 0)) *
                      100
                    ).toFixed(1)
                  ) +
                  "%"}
              </span>
            ) : null}
          </div>
          {showCI ? (
            <div
              className="text-right nowrap ci"
              style={{
                lineHeight: "1.2em",
              }}
            >
              [{percentFormatter.format(stats.ci?.[0] ?? 0)},{" "}
              {percentFormatter.format(stats.ci?.[1] ?? 0)}]
            </div>
          ) : null}
        </td>
      ) : (
        <td />
      )}
    </>
  );
}
