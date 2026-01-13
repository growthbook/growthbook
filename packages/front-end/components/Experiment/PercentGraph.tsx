import { SnapshotMetric } from "shared/types/experiment-snapshot";
import React, { DetailedHTMLProps, HTMLAttributes } from "react";
import {
  ExperimentMetricInterface,
  hasEnoughData,
  isStatSig,
} from "shared/experiments";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
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
  disabled?: boolean;
  graphWidth?: number;
  height?: number;
  className?: string;
  isHovered?: boolean;
  percent?: boolean;
  onMouseMove?: (e: React.MouseEvent<SVGPathElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<SVGPathElement>) => void;
  onClick?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
  rowStatus?: string;
  ssrPolyfills?: SSRPolyfills;
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
  disabled,
  graphWidth,
  height,
  className,
  isHovered = false,
  percent = true,
  onMouseMove,
  onMouseLeave,
  onClick,
  rowStatus,
  ssrPolyfills,
}: Props) {
  const { metricDefaults: _metricDefaults } = useOrganizationMetricDefaults();
  const _confidenceLevels = useConfidenceLevels();
  const _pValueThreshold = usePValueThreshold();

  const metricDefaults =
    ssrPolyfills?.useOrganizationMetricDefaults()?.metricDefaults ||
    _metricDefaults;
  const { ciUpper, ciLower } =
    ssrPolyfills?.useConfidenceLevels() || _confidenceLevels;
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() || _pValueThreshold;

  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);

  const barType = _barType ? _barType : stats.uplift?.dist ? "violin" : "pill";

  const showGraph = !disabled && metric && enoughData;

  if (significant === undefined) {
    if (barType === "pill") {
      // frequentist
      significant = showGraph
        ? isStatSig(stats.pValueAdjusted ?? stats.pValue ?? 1, pValueThreshold)
        : false;
    } else {
      significant = showGraph
        ? (stats.chanceToWin ?? 0) > ciUpper ||
          (stats.chanceToWin ?? 0) < ciLower
        : false;
    }
  }

  return (
    <AlignedGraph
      ci={showGraph ? (stats?.ciAdjusted ?? stats.ci) : [0, 0]}
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
