import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";

// Lightweight, read-only rule-style card with a green left edge, used on the
// feature overview to present the base default value and each environment
// override consistently.
export default function FeatureValueCard({
  sideColor = "var(--green-9)",
  children,
}: {
  sideColor?: string;
  children: ReactNode;
}) {
  return (
    <Box
      style={{
        position: "relative",
        borderRadius: "var(--radius-4)",
        border: "1px solid var(--gray-a5)",
        background: "var(--color-panel-solid)",
      }}
    >
      <Box
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          borderTopLeftRadius: "var(--radius-4)",
          borderBottomLeftRadius: "var(--radius-4)",
          backgroundColor: sideColor,
        }}
      />
      <Box px="5" py="3">
        {children}
      </Box>
    </Box>
  );
}
