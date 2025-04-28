import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { RowResults } from "@/services/experiments";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import NoScaledImpact from "@/components/Experiment/NoScaledImpact";

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  showPercentComplete?: boolean;
  showTimeRemaining?: boolean;
  className?: string;
  hideScaledImpact?: boolean;
}

export default function StatusColumn({
  stats,
  baseline,
  rowResults,
  showPercentComplete = false,
  showTimeRemaining = true,
  className,
  hideScaledImpact = false,
  ...otherProps
}: Props) {
  const statusText =
    rowResults.resultsStatus === "lost" && rowResults.significant
      ? "Failing"
      : "Within bounds";

  return (
    <td
      className={clsx("variation chance align-middle", className)}
      {...otherProps}
    >
      {!baseline || !stats ? (
        <em className="text-gray font-weight-normal">no data</em>
      ) : hideScaledImpact ? (
        <NoScaledImpact />
      ) : !rowResults.enoughData ? (
        <NotEnoughData
          rowResults={rowResults}
          showTimeRemaining={showTimeRemaining}
          showPercentComplete={showPercentComplete}
          showBaselineZero={baseline.value === 0}
        />
      ) : (
        <div className="d-flex align-items-center">
          <div className="result-number d-inline-block">{statusText}</div>
        </div>
      )}
    </td>
  );
}
