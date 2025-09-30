import {
  Tooltip as RadixTooltip,
  type TooltipProps as RadixTooltipProps,
} from "@radix-ui/themes";
import { forwardRef } from "react";

const Tooltip = forwardRef<
  HTMLDivElement,
  RadixTooltipProps & { shouldDisplay?: boolean }
>(({ children, shouldDisplay, ...props }, ref) => {
  if (!shouldDisplay) {
    return <>{children}</>;
  }

  return (
    <RadixTooltip ref={ref} {...props}>
      {children}
    </RadixTooltip>
  );
});

Tooltip.displayName = "Tooltip";

export default Tooltip;
