import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import { RuleCardSideColor, sideColorVar } from "./RuleCard";

// Rule-card chrome (colored left edge + border). Border is a box-shadow and the
// side bar rounds via a decorative clip layer — not `border`/`overflow:hidden` —
// so nothing clips the env select's dropdown menu.
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
