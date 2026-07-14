import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import FeatureCardChrome from "./FeatureCardChrome";
import { RuleCardSideColor } from "./RuleCard";

// Lightweight, read-only rule-style card used on the feature overview to present
// the base default value and each environment override consistently. Chrome
// (colored side bar + border) is shared via FeatureCardChrome.
export default function FeatureValueCard({
  sideColor = "active",
  children,
}: {
  sideColor?: RuleCardSideColor;
  children: ReactNode;
}) {
  return (
    <FeatureCardChrome sideColor={sideColor}>
      <Box px="5" py="3">
        {children}
      </Box>
    </FeatureCardChrome>
  );
}
