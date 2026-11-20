import { DetailedHTMLProps, HTMLAttributes, useRef } from "react";
import Tooltip from "@/ui/Tooltip";
import { useIsOverflowingX } from "@/hooks/useIsOverflowing";

export default function OverflowText({
  children,
  style,
  maxWidth,
  tooltip = false,
  ...props
}: DetailedHTMLProps<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
  maxWidth?: number | string;
  // Shows the full text on hover while it's cut off.
  tooltip?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const truncated = useIsOverflowingX(ref, tooltip, children);
  return (
    <Tooltip content={children} enabled={tooltip && truncated}>
      <span
        ref={ref}
        style={{
          ...style,
          maxWidth: maxWidth ?? 200,
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "inline-block",
          whiteSpace: "nowrap",
          verticalAlign: "bottom",
        }}
        {...props}
      >
        {children}
      </span>
    </Tooltip>
  );
}
