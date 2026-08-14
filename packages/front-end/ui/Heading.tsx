import { Heading as RadixHeading } from "@radix-ui/themes";
import type { HeadingProps as RadixHeadingProps } from "@radix-ui/themes";
import { Size } from "@/ui/sizes";
import { useTx } from "@/services/i18n";

type HeadingSizes = Size<"xs" | "sm" | "md" | "lg" | "xl" | "2xl">;
type HeadingWeights = "medium" | "semibold";
type HeadingAlign = "left" | "center" | "right";
type HeadingWhiteSpace =
  | "pre"
  | "normal"
  | "nowrap"
  | "pre-wrap"
  | "pre-line"
  | "break-spaces";
type HeadingOverflowWrap = "normal" | "anywhere" | "break-word";
// NB: We might need to expand this to support RadixHeadingProps["color"], but being conservative for now.
type HeadingColors = "text-high" | "text-mid" | "text-low";

// Not radixSize: Heading is a type scale, so md means Radix "4" here, not "2".
const radixSizeMap: Record<HeadingSizes, RadixHeadingProps["size"]> = {
  xs: "2",
  sm: "3",
  md: "4",
  lg: "5",
  xl: "6",
  "2xl": "7",
};

const radixWeightMap: Record<HeadingWeights, RadixHeadingProps["weight"]> = {
  medium: "medium",
  semibold: "bold",
};

export interface HeadingProps {
  children: React.ReactNode;
  as: NonNullable<RadixHeadingProps["as"]>;
  size?: HeadingSizes;
  weight?: HeadingWeights;

  color?: HeadingColors;
  align?: HeadingAlign;
  title?: string;
  whiteSpace?: HeadingWhiteSpace;
  overflowWrap?: HeadingOverflowWrap;
  textTransform?: "uppercase" | "lowercase" | "capitalize";

  // Margin props
  m?: RadixHeadingProps["m"];
  mx?: RadixHeadingProps["mx"];
  my?: RadixHeadingProps["my"];
  mt?: RadixHeadingProps["mt"];
  mr?: RadixHeadingProps["mr"];
  mb?: RadixHeadingProps["mb"];
  ml?: RadixHeadingProps["ml"];
}

export default function Heading({
  children,
  size = "md",
  weight = "semibold",
  as,
  color,
  align = "left",
  title,
  whiteSpace,
  overflowWrap = "normal",
  textTransform,
  m,
  mx,
  my,
  mt,
  mr,
  mb,
  ml,
}: HeadingProps) {
  const tx = useTx();
  const style: React.CSSProperties = { overflowWrap };
  if (whiteSpace) style.whiteSpace = whiteSpace;
  if (textTransform) style.textTransform = textTransform;

  if (color === "text-high") {
    style.color = "var(--color-text-high)";
  } else if (color === "text-mid") {
    style.color = "var(--color-text-mid)";
  } else if (color === "text-low") {
    style.color = "var(--color-text-low)";
  }

  return (
    <RadixHeading
      size={radixSizeMap[size]}
      weight={radixWeightMap[weight]}
      align={align}
      as={as}
      title={title}
      style={style}
      m={m}
      mx={mx}
      my={my}
      mt={mt}
      mr={mr}
      // To override default Bootstrap margin
      mb={mb ?? "0"}
      ml={ml}
    >
      {tx(children)}
    </RadixHeading>
  );
}
