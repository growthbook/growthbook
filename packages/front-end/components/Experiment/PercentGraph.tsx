import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import React, { DetailedHTMLProps, HTMLAttributes } from "react";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import { hasEnoughData, isStatSig, RowResults } from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import AlignedGraph from "./AlignedGraph";

interface Props
  extends DetailedHTMLProps<HTMLAttributes<SVGPathElement>, SVGPathElement> {
  metric: MetricInterface;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  domain: [number, number];
  id: string;
  barType?: "pill" | "violin";
  graphWidth?: number;
  height?: number;
  newUi?: boolean;
  rowResults?: RowResults;
  isHovered?: boolean;
  onPointerMove?: (e: React.PointerEvent<SVGPathElement>) => void;
  onPointerLeave?: (e: React.PointerEvent<SVGPathElement>) => void;
  onClick?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
}

export default function PercentGraph({
  metric,
  baseline,
  stats,
  domain,
  id,
  barType: _barType,
  graphWidth,
  height,
  newUi = false,
  rowResults,
  isHovered = false,
  onPointerMove,
  onPointerLeave,
  onClick,
}: Props) {
  const { metricDefaults } = useOrganizationMetricDefaults();
  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();

  const barType = _barType ? _barType : stats.uplift?.dist ? "violin" : "pill";

  const showGraph = metric && enoughData;
  let significant = showGraph
    ? (stats.chanceToWin ?? 0) > ciUpper || (stats.chanceToWin ?? 0) < ciLower
    : false;

  if (newUi && barType === "pill") {
    // frequentist
    significant = showGraph
      ? isStatSig(stats.pValueAdjusted ?? stats.pValue ?? 1, pValueThreshold)
      : false;
  }

  return (
    <AlignedGraph
      ci={showGraph ? stats.ci || [] : [0, 0]}
      id={id}
      domain={domain}
      uplift={showGraph ? stats.uplift : undefined}
      expected={showGraph ? stats.expected : undefined}
      barType={barType}
      barFillType={newUi ? "significant" : "gradient"}
      axisOnly={!showGraph}
      showAxis={false}
      significant={significant}
      graphWidth={graphWidth}
      height={height}
      inverse={!!metric?.inverse}
      newUi={newUi}
      rowResults={rowResults}
      isHovered={isHovered}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
    />
  );
}
