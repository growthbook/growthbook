import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import React, { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { StatsEngine } from "back-end/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
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
  metric: ExperimentMetricInterface;
  stats: SnapshotMetric;
  rowResults: RowResults;
  statsEngine: StatsEngine;
  showPlusMinus?: boolean;
  percent?: boolean;
  showCI?: boolean;
  className?: string;
}

export default function ChangeColumn({
  metric,
  stats,
  rowResults,
  statsEngine,
  showPlusMinus = true,
  showCI = false,
  percent = true,
  className,
  ...otherProps
}: Props) {
  const formatter = percent ? percentFormatter : Intl.NumberFormat();
  const multiplier = percent ? 100 : 1;
  const digits = percent ? 1 : 3;
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
              {parseFloat(((stats.expected ?? 0) * multiplier).toFixed(digits)) + (percent ? "%" : "")}{" "}
            </span>
            {statsEngine === "frequentist" && showPlusMinus ? (
              <span className="plusminus font-weight-normal text-gray ml-1">
                {"±" +
                  parseFloat(
                    (
                      Math.abs((stats.expected ?? 0) - (stats.ci?.[0] ?? 0)) *
                      multiplier
                    ).toFixed(digits)
                  ) +
                  (percent ? "%" : "")}
              </span>
            ) : null}
          </div>
          {showCI ? (
            <div className="ci text-right nowrap font-weight-normal text-gray">
              [{formatter.format(stats.ci?.[0] ?? 0)},{" "}
              {formatter.format(stats.ci?.[1] ?? 0)}]
            </div>
          ) : null}
        </td>
      ) : (
        <td />
      )}
    </>
  );
}
