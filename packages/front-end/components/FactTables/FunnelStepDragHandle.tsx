import React from "react";
import { Box } from "@radix-ui/themes";
import { PiDotsSixVertical } from "react-icons/pi";

// No `handleProps` (pinned step 1): same-size spacer keeps numbers aligned.
export default function FunnelStepDragHandle({
  handleProps,
  label,
}: {
  handleProps?: React.HTMLAttributes<HTMLElement>;
  label: string;
}) {
  if (!handleProps) {
    return <Box aria-hidden style={{ width: 14, flexShrink: 0 }} />;
  }
  return (
    <Box
      {...handleProps}
      title="Drag to reorder"
      aria-label={`Drag to reorder ${label}`}
      style={{ flexShrink: 0, cursor: "grab", display: "flex" }}
    >
      <PiDotsSixVertical size={14} color="var(--gray-a9)" />
    </Box>
  );
}
