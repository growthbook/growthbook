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
  showCI?: boolean;
  className?: string;
}

export default function PercentChangeColumn({
  metric,
  stats,
  rowResults,
  statsEngine,
  showPlusMinus = true,
  showCI = false,
  className,
  ...otherProps
}: Props) {
  const expected = stats?.expected ?? 0;
  const ci0 = stats?.ciAdjusted?.[0] ?? stats?.ci?.[0] ?? 0;
  const ci1 = stats?.ciAdjusted?.[1] ?? stats?.ci?.[1] ?? 0;
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
              {parseFloat((expected * 100).toFixed(1)) + "%"}{" "}
            </span>
            {statsEngine === "frequentist" && showPlusMinus ? (
              <span className="plusminus font-weight-normal text-gray ml-1">
                ±
                {Math.abs(ci0) === Infinity || Math.abs(ci1) === Infinity ? (
                  <span style={{ fontSize: "18px", verticalAlign: "-2px" }}>
                    ∞
                  </span>
                ) : (
                  parseFloat((Math.abs(expected - ci0) * 100).toFixed(1))
                )}
                %
              </span>
            ) : null}
          </div>
          {showCI ? (
            <div className="ci text-right nowrap font-weight-normal text-gray">
              [{percentFormatter.format(ci0)}, {percentFormatter.format(ci1)}]
            </div>
          ) : null}
        </td>
      ) : (
        <td />
      )}
    </>
  );
}
