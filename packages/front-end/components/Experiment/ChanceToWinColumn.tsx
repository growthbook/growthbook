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
  const { isDraw, SuspiciousTrigger, NotEnoughDataTrigger, DrawTrigger } =
    useColumnStatusPopovers({
      stats,
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
        <NotEnoughDataTrigger>
          <NotEnoughData
            rowResults={rowResults}
            showTimeRemaining={showTimeRemaining}
            showPercentComplete={showPercentComplete}
          />
        </NotEnoughDataTrigger>
      ) : isDraw ? (
        <DrawTrigger>
          <Flex direction="row" align="center" gap="1">
            <div className="result-number d-inline-block">
              {percentFormatter.format(stats.chanceToWin ?? 0)}
            </div>
            <PiWarningCircle
              size={15}
              style={{ color: "var(--color-text-high)" }}
            />
          </Flex>
        </DrawTrigger>
      ) : showSuspicious && rowResults.suspiciousChange ? (
        <SuspiciousTrigger>
          <Flex direction="row" align="center" gap="1">
            <div className="result-number d-inline-block">
              {percentFormatter.format(stats.chanceToWin ?? 0)}
            </div>
            <PiWarningCircle
              size={15}
              style={{ color: "var(--color-text-high)" }}
            />
          </Flex>
        </SuspiciousTrigger>
      ) : (
        <div className="result-number d-inline-block">
          {percentFormatter.format(stats.chanceToWin ?? 0)}
        </div>
      )}
    </td>
  );
}
