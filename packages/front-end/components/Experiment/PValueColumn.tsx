import clsx from "clsx";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";
import type { DetailedHTMLProps, TdHTMLAttributes } from "react";
import type {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import type { ExperimentMetricDefinition } from "shared/experiments";
import { PiWarningCircle } from "react-icons/pi";
import { pValueFormatter, type RowResults } from "@/services/experiments";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import NoScaledImpact from "@/components/Experiment/NoScaledImpact";
import type { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useColumnStatusPopovers } from "./useColumnStatusPopovers";

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  stats: SnapshotMetric;
  rowResults: RowResults;
  pValueCorrection?: PValueCorrection;
  showSuspicious?: boolean;
  showPercentComplete?: boolean;
  showTimeRemaining?: boolean;
  showUnadjustedPValue?: boolean;
  className?: string;
  hideScaledImpact?: boolean;
  // Props for popover
  metric?: ExperimentMetricDefinition;
  pValueThreshold: number;
  differenceType?: DifferenceType;
  statsEngine?: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
  minSampleSize?: number;
  pValueAdjustmentEnabled?: boolean;
}

export default function PValueColumn({
  stats,
  rowResults,
  pValueCorrection,
  showSuspicious = true,
  showPercentComplete = false,
  showTimeRemaining = true,
  showUnadjustedPValue = false,
  className,
  hideScaledImpact = false,
  metric,
  pValueThreshold,
  differenceType,
  statsEngine,
  ssrPolyfills,
  minSampleSize = 0,
  pValueAdjustmentEnabled,
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

  const { statusType, Trigger } = useColumnStatusPopovers({
    stats,
    rowResults,
    metric,
    pValueThreshold,
    differenceType,
    statsEngine,
    ssrPolyfills,
    minSampleSize,
    showSuspicious,
    pValueAdjustmentEnabled,
  });

  const renderContent = () => {
    if (!rowResults.hasData) {
      return <em className="text-muted small">No data</em>;
    }

    if (hideScaledImpact) {
      return <NoScaledImpact />;
    }

    if (statusType === "notEnoughData") {
      return (
        <Trigger>
          <NotEnoughData
            rowResults={rowResults}
            showTimeRemaining={showTimeRemaining}
            showPercentComplete={showPercentComplete}
          />
        </Trigger>
      );
    }

    if (statusType === "draw" || statusType === "suspicious") {
      return (
        <Trigger>
          <div className="d-flex align-items-center justify-content-end">
            <div className="result-number d-inline-block">
              {pValText || "P-value missing"}
            </div>{" "}
            <PiWarningCircle
              size={15}
              style={{ color: "var(--color-text-high)" }}
            />
          </div>
        </Trigger>
      );
    }

    return (
      <div className="d-flex align-items-center justify-content-end">
        <div className="result-number d-inline-block">
          {pValText || "P-value missing"}
        </div>
      </div>
    );
  };

  return (
    <td
      className={clsx("variation chance align-middle", className)}
      {...otherProps}
    >
      {renderContent()}
    </td>
  );
}
