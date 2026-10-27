import { FC } from "react";
import Badge, { Size } from "@/ui/Badge";

export type Results = "won" | "lost" | "dnf" | "inconclusive";

const getColorAndVariant = (
  results: Results,
): [
  React.ComponentProps<typeof Badge>["color"],
  React.ComponentProps<typeof Badge>["variant"],
] => {
  switch (results) {
    case "won":
      return ["green", "solid"];
    case "lost":
      return ["red", "solid"];
    case "dnf":
      return ["amber", "soft"];
    case "inconclusive":
      return ["gray", "solid"];
  }
};

export const RESULT_LABELS: Record<Results, string> = {
  won: "Won",
  lost: "Lost",
  dnf: "Didn't finish",
  inconclusive: "Inconclusive",
};

const ResultsIndicator: FC<{
  results: Results;
  size?: Size;
}> = ({ results, size }) => {
  const [color, variant] = getColorAndVariant(results);

  return (
    <Badge
      color={color}
      variant={variant}
      radius="full"
      size={size}
      label={RESULT_LABELS[results]}
    />
  );
};

export default ResultsIndicator;
