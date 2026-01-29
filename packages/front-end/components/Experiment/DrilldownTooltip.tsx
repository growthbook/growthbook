import React, { useCallback } from "react";
import { useHoverAnchor } from "@/hooks/useHoverAnchor";

interface DrilldownTooltipHandlers {
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

interface DrilldownTooltipProps {
  enabled: boolean;
  children: (handlers: DrilldownTooltipHandlers) => React.ReactNode;
}

/**
 * A wrapper component that provides drilldown tooltip functionality.
 * Uses render props pattern to pass mouse handlers to children.
 */
export function DrilldownTooltip({ enabled, children }: DrilldownTooltipProps) {
  const { handleMouseEnter, handleMouseMove, handleMouseLeave, renderTooltip } =
    useHoverAnchor({
      delayMs: 1500,
      enabled,
      positioning: "cursor",
    });

  // Combine enter and move handlers since tbody only has onMouseMove
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      handleMouseEnter(e);
      handleMouseMove(e);
    },
    [handleMouseEnter, handleMouseMove],
  );

  return (
    <>
      {children({
        onMouseMove,
        onMouseLeave: handleMouseLeave,
      })}
      {renderTooltip(
        <>
          Click anywhere in a row to
          <br />
          open the Metric Drilldown.
        </>,
      )}
    </>
  );
}
