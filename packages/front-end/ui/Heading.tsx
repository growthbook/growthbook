import { Heading as RadixHeading } from "@radix-ui/themes";
import type { HeadingProps as RadixHeadingProps } from "@radix-ui/themes";

type HeadingSizes =
  | "x-small"
  | "small"
  | "medium"
  | "large"
  | "x-large"
  | "2x-large";
type HeadingWeights = "medium" | "semibold";
type HeadingAlign = "left" | "center" | "right";
type HeadingWhiteSpace =
  | "pre"
  | "normal"
  | "nowrap"
  | "pre-wrap"
  | "pre-line"
  | "break-spaces";
// NB: We might need to expand this to support RadixHeadingProps["color"], but being conservative for now.
type HeadingColors = "text-high" | "text-mid" | "text-low";

const radixSizeMap: Record<HeadingSizes, RadixHeadingProps["size"]> = {
  "x-small": "2",
  small: "3",
  medium: "4",
  large: "5",
  "x-large": "6",
  "2x-large": "7",
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
  size = "medium",
  weight = "semibold",
  as,
  color,
  align = "left",
  title,
  whiteSpace,
  m,
  mx,
  my,
  mt,
  mr,
  mb,
  ml,
}: HeadingProps) {
  const style: React.CSSProperties = whiteSpace ? { whiteSpace } : {};

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
      {children}
    </RadixHeading>
  );
}
