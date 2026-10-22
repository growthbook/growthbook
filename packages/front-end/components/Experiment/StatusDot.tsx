import { forwardRef, HTMLAttributes } from "react";
import { Box } from "@radix-ui/themes";

// Forwards its ref and props, so it can be a tooltip's trigger.
const StatusDot = forwardRef<
  HTMLDivElement,
  {
    color: string;
    /** Sits in a line of text rather than in a flex row. */
    inline?: boolean;
  } & HTMLAttributes<HTMLDivElement>
>(function StatusDot({ color, inline = false, style, ...props }, ref) {
  return (
    <Box
      {...props}
      ref={ref}
      as={inline ? "span" : "div"}
      display={inline ? "inline-block" : undefined}
      style={{
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        ...(inline && { verticalAlign: "middle" }),
        ...style,
      }}
    />
  );
});

export default StatusDot;
