import React, { useCallback } from "react";
import { useHoverAnchor } from "@/hooks/useHoverAnchor";

/**
 * Check if an element is interactive (links, buttons, etc.)
 * Used to prevent drilldown actions when interacting with these elements.
 */
export function isInteractiveElement(target: HTMLElement): boolean {
  return !!(
    target.closest("a") ||
    target.closest("button") ||
    target.closest("[role='button']")
  );
}

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
 *
 * The tooltip only shows when hovering over non-interactive elements,
 * matching the behavior of the row click handler.
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
      // Don't show tooltip when hovering over interactive elements
      const target = e.target as HTMLElement;
      if (isInteractiveElement(target)) {
        handleMouseLeave();
        return;
      }

      handleMouseEnter(e);
      handleMouseMove(e);
    },
    [handleMouseEnter, handleMouseMove, handleMouseLeave],
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
