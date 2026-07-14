import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import { RuleCardSideColor, sideColorVar } from "./RuleCard";

// Box-based rule-card chrome: colored left edge + 1px border drawn via
// box-shadow (not `border`, so it doesn't inset the layout box or clip inner
// popovers/menus). Shared by the read-only overview card (FeatureValueCard) and
// the editable modal card (ModalValueCard) — RuleCard keeps its Radix Card
// container, but the side-color palette (sideColorVar) is the single shared
// source so these can't drift from the rule cards they mirror.
//
// The side bar is rounded to the card's corners via a decorative clip layer
// rather than `overflow: hidden` on the card itself, which would clip the env
// select's dropdown menu in the editable card.
export default function FeatureCardChrome({
  sideColor,
  children,
}: {
  sideColor: RuleCardSideColor;
  children: ReactNode;
}) {
  return (
    <Box
      style={{
        position: "relative",
        borderRadius: "var(--radius-4)",
        boxShadow: "inset 0 0 0 1px var(--gray-a5)",
        background: "var(--color-panel-solid)",
      }}
    >
      <Box
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "var(--radius-4)",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <Box
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: sideColorVar[sideColor],
          }}
        />
      </Box>
      {children}
    </Box>
  );
}
