import React, {
  CSSProperties,
  ReactNode,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { ExperimentMetricDefinition } from "shared/experiments";
import { RowResults } from "@/services/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { HoverAnchor, useHoverTooltip } from "@/hooks/useHoverTooltip";
import { PopoverContent } from "@/ui/Popover";
import ExperimentResultTooltipContent, {
  StatusLabels,
} from "./ExperimentResultTooltipContent/ExperimentResultTooltipContent";

interface ResultPopoverData {
  stats: SnapshotMetric;
  metric: ExperimentMetricDefinition;
  pValueThreshold: number;
  significant: boolean;
  resultsStatus: RowResults["resultsStatus"];
  differenceType: DifferenceType;
  statsEngine: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
  suspiciousChange: boolean;
  suspiciousThreshold: number;
  notEnoughData: boolean;
  minSampleSize: number;
  minPercentChange: number;
  currentMetricTotal: number;
  timeRemainingMs?: number;
  pValueAdjustmentEnabled?: boolean;
  statusLabels?: StatusLabels;
}

interface UseResultPopoverOptions {
  enabled: boolean;
  positioning?: "element" | "cursor";
  // On the CI graph: stands over the row's mean, with a tail pointing at it.
  pointsAtMean?: boolean;
  data: ResultPopoverData;
}

interface TriggerProps {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

// Stable Trigger component defined outside the hook to prevent remounting
interface InternalTriggerProps extends TriggerProps {
  propsRef: React.RefObject<{
    enabled: boolean;
    triggerProps: {
      onMouseEnter: (e: React.MouseEvent) => void;
      onMouseMove: (e: React.MouseEvent) => void;
      onMouseLeave: (e: React.MouseEvent) => void;
      onClick: (e: React.MouseEvent) => void;
    };
    renderPopover: () => React.ReactNode;
  }>;
}

function ResultPopoverTrigger({
  children,
  style,
  className,
  propsRef,
}: InternalTriggerProps) {
  const { enabled, triggerProps, renderPopover } = propsRef.current!;
  return (
    <span
      className={className}
      style={{
        ...style,
        cursor: enabled ? "pointer" : undefined,
      }}
      {...triggerProps}
    >
      {children}
      {renderPopover()}
    </span>
  );
}

// Over the mean on its row's graph: against the graph's edge when the mean is
// off it, and over the trigger when it's unknown.
function meanAnchor(trigger: HTMLElement): HoverAnchor | null {
  const graph = trigger
    .closest("tr")
    ?.querySelector<SVGSVGElement>("svg[data-mean-x]");
  const meanX = Number(graph?.dataset.meanX);
  if (!graph || !Number.isFinite(meanX)) return null;
  const rect = graph.getBoundingClientRect();
  if (meanX < 0) return { x: rect.left, align: "start" };
  if (meanX > rect.width) return { x: rect.right, align: "end" };
  return { x: rect.left + meanX, align: "center" };
}

export function useResultPopover({
  enabled,
  positioning = "element",
  pointsAtMean = false,
  data,
}: UseResultPopoverOptions) {
  const { triggerProps, isVisible, renderTooltip, close } = useHoverTooltip({
    enabled,
    positioning,
    arrow: pointsAtMean,
    anchor: pointsAtMean ? meanAnchor : undefined,
  });

  // Wrapper to make handleMouseLeave callable without arguments for backward compatibility
  const handleMouseLeave = useCallback(
    (e?: React.MouseEvent) => {
      if (e) {
        triggerProps.onMouseLeave(e);
      } else {
        // If called without an event, just close the tooltip
        close();
      }
    },
    [triggerProps, close],
  );

  const renderPopover = useCallback(() => {
    if (!enabled || !isVisible) {
      return null;
    }

    return renderTooltip(
      <PopoverContent>
        <ExperimentResultTooltipContent
          stats={data.stats}
          metric={data.metric}
          pValueThreshold={data.pValueThreshold}
          significant={data.significant}
          resultsStatus={data.resultsStatus}
          differenceType={data.differenceType}
          statsEngine={data.statsEngine}
          ssrPolyfills={data.ssrPolyfills}
          suspiciousChange={data.suspiciousChange}
          suspiciousThreshold={data.suspiciousThreshold}
          notEnoughData={data.notEnoughData}
          minSampleSize={data.minSampleSize}
          minPercentChange={data.minPercentChange}
          currentMetricTotal={data.currentMetricTotal}
          timeRemainingMs={data.timeRemainingMs}
          pValueAdjustmentEnabled={data.pValueAdjustmentEnabled}
          statusLabels={data.statusLabels}
        />
      </PopoverContent>,
    );
  }, [enabled, isVisible, renderTooltip, data]);

  // Use a ref to pass current values to the stable Trigger component
  const triggerPropsRef = useRef({ enabled, triggerProps, renderPopover });
  triggerPropsRef.current = { enabled, triggerProps, renderPopover };

  // Memoize the Trigger component so it maintains stable identity across renders
  // This prevents React from unmounting/remounting the span element
  const Trigger = useMemo(() => {
    return function Trigger({ children, style, className }: TriggerProps) {
      return (
        <ResultPopoverTrigger
          propsRef={triggerPropsRef}
          style={style}
          className={className}
        >
          {children}
        </ResultPopoverTrigger>
      );
    };
  }, []);

  return {
    Trigger,
    triggerProps,
    // Expose individual handlers for backward compatibility
    handleMouseEnter: triggerProps.onMouseEnter,
    handleMouseMove: triggerProps.onMouseMove,
    handleMouseLeave,
    renderPopover,
  };
}
