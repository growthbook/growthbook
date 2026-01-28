import { SnapshotMetric } from "shared/types/experiment-snapshot";
import React, { DetailedHTMLProps, HTMLAttributes } from "react";
import {
  ExperimentMetricInterface,
  hasEnoughData,
  isStatSig,
} from "shared/experiments";
import { DifferenceType } from "shared/types/stats";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { useCursorTooltip } from "@/hooks/useCursorTooltip";
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
  differenceType?: DifferenceType;
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
  differenceType = "relative",
}: Props) {
  const { metricDefaults: _metricDefaults } = useOrganizationMetricDefaults();
  const _confidenceLevels = useConfidenceLevels();
  const _pValueThreshold = usePValueThreshold();
  const _displayCurrency = useCurrency();
  const { getFactTableById: _getFactTableById } = useDefinitions();

  const metricDefaults =
    ssrPolyfills?.useOrganizationMetricDefaults()?.metricDefaults ||
    _metricDefaults;
  const { ciUpper, ciLower, ciUpperDisplay } =
    ssrPolyfills?.useConfidenceLevels() || _confidenceLevels;
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() || _pValueThreshold;
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _displayCurrency;
  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;

  const {
    handleMouseMove: tooltipMouseMove,
    handleMouseLeave: tooltipMouseLeave,
    renderTooltip,
  } = useCursorTooltip();

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

  const formatCI = () => {
    const ci = stats?.ciAdjusted ?? stats?.ci;
    if (!ci || ci.length < 2) return null;

    const formatter =
      differenceType === "relative"
        ? formatPercent
        : getExperimentMetricFormatter(
            metric,
            getFactTableById,
            differenceType === "absolute" ? "percentagePoints" : "number",
          );
    const formatterOptions: Intl.NumberFormatOptions = {
      currency: displayCurrency,
      ...(differenceType === "relative" ? { maximumFractionDigits: 1 } : {}),
      ...(differenceType === "scaled" ? { notation: "compact" } : {}),
    };

    return `${ciUpperDisplay} CI: [${formatter(ci[0], formatterOptions)}, ${formatter(ci[1], formatterOptions)}]`;
  };

  const ciText = showGraph ? formatCI() : null;

  // Combine external mouse handlers with tooltip handlers
  const handleMouseMove = (e: React.MouseEvent<SVGPathElement>) => {
    if (ciText) {
      tooltipMouseMove(e);
    }
    onMouseMove?.(e);
  };

  const handleMouseLeave = (e: React.MouseEvent<SVGPathElement>) => {
    if (ciText) {
      tooltipMouseLeave();
    }
    onMouseLeave?.(e);
  };

  return (
    <>
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
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={onClick}
        rowStatus={rowStatus}
      />
      {ciText && renderTooltip(ciText)}
    </>
  );
}
