import { DetailedHTMLProps, HTMLAttributes } from "react";

export default function OverflowText({
  children,
  style,
  maxWidth,
  ...props
}: DetailedHTMLProps<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
  maxWidth?: number;
}) {
  return (
    <span
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
  );
}
