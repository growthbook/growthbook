import { forwardRef } from "react";
import {
  Tooltip as RadixTooltip,
  TooltipProps as RadixTooltipProps,
} from "@radix-ui/themes";

type TooltipProps = Omit<RadixTooltipProps, "style" | "className"> & {
  enabled?: boolean;
};

const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(
  ({ children, enabled = true, ...props }, ref) => {
    if (!enabled) {
      return <>{children}</>;
    }

    return (
      <RadixTooltip {...props} ref={ref}>
        {children}
      </RadixTooltip>
    );
  },
);

Tooltip.displayName = "Tooltip";
export default Tooltip;
