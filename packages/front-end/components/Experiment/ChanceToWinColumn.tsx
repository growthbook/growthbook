import clsx from "clsx";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { PiWarningCircle } from "react-icons/pi";
import { RowResults } from "@/services/experiments";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import NoScaledImpact from "@/components/Experiment/NoScaledImpact";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useColumnStatusPopovers } from "./useColumnStatusPopovers";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  showSuspicious?: boolean;
  showPercentComplete?: boolean;
  showTimeRemaining?: boolean;
  className?: string;
  hideScaledImpact?: boolean;
  // Props for popover
  metric?: ExperimentMetricInterface;
  differenceType?: DifferenceType;
  statsEngine?: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
  minSampleSize?: number;
}
export default function ChanceToWinColumn({
  stats,
  baseline,
  rowResults,
  showSuspicious = true,
  showPercentComplete = false,
  showTimeRemaining = true,
  className,
  hideScaledImpact = false,
  metric,
  differenceType,
  statsEngine,
  ssrPolyfills,
  minSampleSize = 0,
  ...otherProps
}: Props) {
  const {
    popoverEnabled,
    suspiciousPopover,
    notEnoughDataPopover,
    drawPopover,
    isDraw,
  } = useColumnStatusPopovers({
    stats,
    baseline,
    rowResults,
    metric,
    differenceType,
    statsEngine,
    ssrPolyfills,
    minSampleSize,
    showSuspicious,
  });

  return (
    <td className={clsx("chance align-middle", className)} {...otherProps}>
      {!baseline?.value || !stats?.value ? (
        <em className="text-muted small">No data</em>
      ) : hideScaledImpact ? (
        <NoScaledImpact />
      ) : !rowResults.enoughData ? (
        <div
          onMouseEnter={notEnoughDataPopover.handleMouseEnter}
          onMouseMove={notEnoughDataPopover.handleMouseMove}
          onMouseLeave={notEnoughDataPopover.handleMouseLeave}
          style={{ cursor: popoverEnabled ? "pointer" : undefined }}
        >
          <NotEnoughData
            rowResults={rowResults}
            showTimeRemaining={showTimeRemaining}
            showPercentComplete={showPercentComplete}
          />
          {notEnoughDataPopover.renderPopover()}
        </div>
      ) : (
        <>
          <div className="result-number d-inline-block">
            {percentFormatter.format(stats.chanceToWin ?? 0)}
          </div>
          {isDraw ? (
            <span
              style={{
                marginLeft: 4,
                cursor: popoverEnabled ? "pointer" : undefined,
                color: "var(--amber-a11)",
              }}
              onMouseEnter={drawPopover.handleMouseEnter}
              onMouseMove={drawPopover.handleMouseMove}
              onMouseLeave={drawPopover.handleMouseLeave}
            >
              <PiWarningCircle size={15} />
              {drawPopover.renderPopover()}
            </span>
          ) : showSuspicious && rowResults.suspiciousChange ? (
            <span
              className="suspicious"
              style={{
                marginLeft: 1,
                cursor: popoverEnabled ? "pointer" : undefined,
              }}
              onMouseEnter={suspiciousPopover.handleMouseEnter}
              onMouseMove={suspiciousPopover.handleMouseMove}
              onMouseLeave={suspiciousPopover.handleMouseLeave}
            >
              <PiWarningCircle size={15} />
              {suspiciousPopover.renderPopover()}
            </span>
          ) : null}
        </>
      )}
    </td>
  );
}
