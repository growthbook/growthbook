import { FC } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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

export const RESULT_LABELS: Record<Results, MessageDescriptor> = {
  won: msg`Won`,
  lost: msg`Lost`,
  dnf: msg`Didn't finish`,
  inconclusive: msg`Inconclusive`,
};

const ResultsIndicator: FC<{
  results: Results;
  size?: Size;
}> = ({ results, size }) => {
  const { i18n } = useLingui();
  const [color, variant] = getColorAndVariant(results);

  return (
    <Badge
      color={color}
      variant={variant}
      radius="full"
      size={size}
      label={i18n._(RESULT_LABELS[results])}
    />
  );
};

export default ResultsIndicator;
