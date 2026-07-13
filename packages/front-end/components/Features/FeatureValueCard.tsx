import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";

// Lightweight, read-only rule-style card with a green left edge, used on the
// feature overview to present the base default value and each environment
// override consistently. The 1px border is a box-shadow (not a `border`) so it
// doesn't inset the layout box — that lets the colored side bar sit flush to
// the edge and round with the corners, matching the rule cards.
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
        boxShadow: "inset 0 0 0 1px var(--gray-a5)",
        background: "var(--color-panel-solid)",
        // Clip the side bar to the card's radius (like the rule cards) so its
        // corners match. Safe here — the read-only card has no popover/menu.
        overflow: "hidden",
      }}
    >
      <Box
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: sideColor,
        }}
      />
      <Box px="5" py="3">
        {children}
      </Box>
    </Box>
  );
}
