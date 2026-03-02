import { FC } from "react";
import Badge from "@/ui/Badge";

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

const displayName = {
  won: "Won",
  lost: "Lost",
  dnf: "Didn't finish",
  inconclusive: "Inconclusive",
};

const ResultsIndicator: FC<{
  results: Results;
}> = ({ results }) => {
  const [color, variant] = getColorAndVariant(results);

  return (
    <Badge
      color={color}
      variant={variant}
      radius="full"
      label={displayName[results]}
    />
  );
};

export default ResultsIndicator;
