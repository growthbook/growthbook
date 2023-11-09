import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import React, { DetailedHTMLProps, HTMLAttributes } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import { hasEnoughData, isStatSig } from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import AlignedGraph from "./AlignedGraph";

interface Props
  extends DetailedHTMLProps<HTMLAttributes<SVGPathElement>, SVGPathElement> {
  metric: ExperimentMetricInterface;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  domain: [number, number];
  id: string;
  barType?: "pill" | "violin";
  barFillType?: "gradient" | "significant";
  significant?: boolean;
  graphWidth?: number;
  height?: number;
  newUi?: boolean;
  className?: string;
  isHovered?: boolean;
  percent?: boolean;
  onMouseMove?: (e: React.MouseEvent<SVGPathElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<SVGPathElement>) => void;
  onClick?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
  rowStatus?: string;
}

export default function PercentGraph({
  metric,
  baseline,
  stats,
  domain,
  id,
  barType: _barType,
  barFillType = "gradient",
  significant,
  graphWidth,
  height,
  newUi = false,
  className,
  isHovered = false,
  percent = true,
  onMouseMove,
  onMouseLeave,
  onClick,
  rowStatus,
}: Props) {
  const { metricDefaults } = useOrganizationMetricDefaults();
  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();

  const barType = _barType ? _barType : stats.uplift?.dist ? "violin" : "pill";

  const showGraph = metric && enoughData;

  if (significant === undefined) {
    significant = showGraph
      ? (stats.chanceToWin ?? 0) > ciUpper || (stats.chanceToWin ?? 0) < ciLower
      : false;

    if (newUi && barType === "pill") {
      // frequentist
      significant = showGraph
        ? isStatSig(stats.pValueAdjusted ?? stats.pValue ?? 1, pValueThreshold)
        : false;
    }
  }

  return (
    <AlignedGraph
      ci={showGraph ? stats?.ciAdjusted ?? stats.ci ?? [] : [0, 0]}
      id={id}
      domain={domain}
      uplift={showGraph ? stats.uplift : undefined}
      expected={showGraph ? stats.expected : undefined}
      barType={barType}
      barFillType={barFillType}
      axisOnly={!showGraph}
      showAxis={false}
      significant={significant}
      graphWidth={graphWidth}
      height={height}
      inverse={!!metric?.inverse}
      newUi={newUi}
      className={className}
      isHovered={isHovered}
      percent={percent}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      rowStatus={rowStatus}
    />
  );
}
