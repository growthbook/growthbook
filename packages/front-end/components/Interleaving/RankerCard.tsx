import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import VariationLabel from "@/ui/VariationLabel";

export const RANKERS = [
  { role: "control", label: "Control" },
  { role: "treatment", label: "Treatment" },
] as const;

export type RankerRole = (typeof RANKERS)[number]["role"];

// One card shell for both the editor and the read-only overview, so the two
// can't drift. Children are the fields or the rendered values.
export default function RankerCard({
  index,
  name,
  children,
}: {
  index: number;
  name: string;
  children: ReactNode;
}) {
  return (
    <Frame p="5" pb="3" mb="0" position="relative" className="variation">
      {/* No @/ui token for the variation color scale, so these stay. */}
      <Box
        className={`variation variation${index} with-variation-color`}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          height: "6px",
        }}
      />
      <Box mb="3">
        <VariationLabel number={index} name={name} size="lg" />
      </Box>
      {children}
    </Frame>
  );
}
