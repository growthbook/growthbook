import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
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
  const { statusType, Trigger } = useColumnStatusPopovers({
    stats,
    rowResults,
    metric,
    differenceType,
    statsEngine,
    ssrPolyfills,
    minSampleSize,
    showSuspicious,
  });

  const renderContent = () => {
    if (!baseline?.value || !stats?.value) {
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
          <Flex direction="row" align="center" gap="1">
            <div className="result-number d-inline-block">
              {percentFormatter.format(stats.chanceToWin ?? 0)}
            </div>
            <PiWarningCircle
              size={15}
              style={{ color: "var(--color-text-high)" }}
            />
          </Flex>
        </Trigger>
      );
    }

    return (
      <div className="result-number d-inline-block">
        {percentFormatter.format(stats.chanceToWin ?? 0)}
      </div>
    );
  };

  return (
    <td className={clsx("chance align-middle", className)} {...otherProps}>
      {renderContent()}
    </td>
  );
}
