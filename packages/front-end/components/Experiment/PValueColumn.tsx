import clsx from "clsx";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { DetailedHTMLProps, TdHTMLAttributes } from "react";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { PiWarningCircle } from "react-icons/pi";
import { pValueFormatter, RowResults } from "@/services/experiments";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import NoScaledImpact from "@/components/Experiment/NoScaledImpact";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useColumnStatusPopovers } from "./useColumnStatusPopovers";

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  pValueCorrection?: PValueCorrection;
  showSuspicious?: boolean;
  showPercentComplete?: boolean;
  showTimeRemaining?: boolean;
  showUnadjustedPValue?: boolean;
  className?: string;
  hideScaledImpact?: boolean;
  // Props for popover
  metric?: ExperimentMetricInterface;
  differenceType?: DifferenceType;
  statsEngine?: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
  minSampleSize?: number;
}

export default function PValueColumn({
  stats,
  baseline,
  rowResults,
  pValueCorrection,
  showSuspicious = true,
  showPercentComplete = false,
  showTimeRemaining = true,
  showUnadjustedPValue = false,
  className,
  hideScaledImpact = false,
  metric,
  differenceType,
  statsEngine,
  ssrPolyfills,
  minSampleSize = 0,
  ...otherProps
}: Props) {
  let pValText = (
    <>{stats?.pValue !== undefined ? pValueFormatter(stats.pValue) : ""}</>
  );
  if (stats?.pValueAdjusted !== undefined && pValueCorrection) {
    pValText = showUnadjustedPValue ? (
      <>
        <div>{pValueFormatter(stats.pValueAdjusted)}</div>
        <div className="text-muted">(unadj.:&nbsp;{pValText})</div>
      </>
    ) : (
      <>{pValueFormatter(stats.pValueAdjusted)}</>
    );
  }

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
    <td
      className={clsx("variation chance align-middle", className)}
      {...otherProps}
    >
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
        <div className="d-flex align-items-center justify-content-end">
          <div className="result-number d-inline-block">
            {pValText || "P-value missing"}
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
        </div>
      )}
    </td>
  );
}
