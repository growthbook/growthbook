import React from "react";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { RowResults } from "@/services/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useHoverAnchor, UseHoverAnchorOptions } from "@/hooks/useHoverAnchor";
import { Popover } from "@/ui/Popover";
import ExperimentResultTooltipContent from "./ExperimentResultTooltipContent/ExperimentResultTooltipContent";
import styles from "./PercentGraph.module.scss";

const POPOVER_VERTICAL_OFFSET = 10;

interface ResultPopoverData {
  stats: SnapshotMetric;
  metric: ExperimentMetricInterface;
  significant: boolean;
  resultsStatus: RowResults["resultsStatus"];
  differenceType: DifferenceType;
  statsEngine: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
}

interface UseResultPopoverOptions
  extends Pick<UseHoverAnchorOptions, "positioning"> {
  enabled: boolean;
  data: ResultPopoverData;
}

export function useResultPopover({
  enabled,
  positioning = "cursor",
  data,
}: UseResultPopoverOptions) {
  const {
    handleMouseEnter,
    handleMouseMove,
    handleMouseLeave,
    renderAtAnchor,
    isVisible,
  } = useHoverAnchor({ enabled, positioning });

  const renderPopover = () => {
    if (!enabled || !isVisible) {
      return null;
    }

    return renderAtAnchor((pos) => (
      <Popover
        open={true}
        onOpenChange={() => {}}
        trigger={
          <span
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y - POPOVER_VERTICAL_OFFSET,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        }
        contentStyle={{
          padding: 0,
        }}
        anchorOnly
        side="top"
        align="center"
        showArrow={false}
        contentClassName={styles.popoverContent}
        content={
          <ExperimentResultTooltipContent
            stats={data.stats}
            metric={data.metric}
            significant={data.significant}
            resultsStatus={data.resultsStatus}
            differenceType={data.differenceType}
            statsEngine={data.statsEngine}
            ssrPolyfills={data.ssrPolyfills}
          />
        }
      />
    ));
  };

  return {
    handleMouseEnter,
    handleMouseMove,
    handleMouseLeave,
    renderPopover,
  };
}
