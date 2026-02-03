import React, { useCallback } from "react";
import { Text, Theme } from "@radix-ui/themes";
import { useHoverTooltip } from "@/hooks/useHoverTooltip";

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
  onClick: () => void;
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
  const { triggerProps, close, renderTooltip } = useHoverTooltip({
    delayMs: 1500,
    enabled,
    positioning: "cursor",
  });

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (isInteractiveElement(target)) {
        close();
        return;
      }

      triggerProps.onMouseEnter(e);
      triggerProps.onMouseMove(e);
    },
    [triggerProps, close],
  );

  return (
    <>
      {children({
        onMouseMove,
        onMouseLeave: () => triggerProps.onMouseLeave({} as React.MouseEvent),
        onClick: close,
      })}
      {renderTooltip(
        <Theme>
          <div className="rt-TooltipContent">
            <Text as="p" className="rt-TooltipText" size="1">
              Click anywhere in a row to
              <br />
              open the Metric Drilldown.
            </Text>
          </div>
        </Theme>,
      )}
    </>
  );
}
