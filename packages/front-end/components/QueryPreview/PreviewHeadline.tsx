import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";

// The large number above a preview chart. Truncates with a full-value tooltip
// so a long formatted value can't overflow a narrow panel.
export default function PreviewHeadline({
  value,
  title,
  children,
}: {
  value: string;
  /** Untruncated value for the native tooltip. */
  title?: string;
  /** Rendered after the number, e.g. an info button. */
  children?: ReactNode;
}) {
  return (
    <Flex align="start" gap="1" minWidth="0">
      <div
        title={title}
        style={{
          fontSize: "3rem",
          lineHeight: 1.2,
          fontWeight: 600,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      {children}
    </Flex>
  );
}
