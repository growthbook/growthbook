import { Text as RadixText } from "@radix-ui/themes";
import type { TextProps as RadixTextProps } from "@radix-ui/themes";

type TextSizes = "small" | "medium" | "large" | "inherit";
type TextWeights = "regular" | "medium" | "semibold";
type TextAlign = "left" | "center" | "right";
type TextOverflowWrap = "normal" | "anywhere" | "break-word";
type TextWhiteSpace =
  | "pre"
  | "normal"
  | "nowrap"
  | "pre-wrap"
  | "pre-line"
  | "break-spaces";
// NB: We might need to expand this to support RadixTextProps["color"], but being conservative for now.
type TextColors = "text-high" | "text-mid" | "text-low" | "text-disabled";

const radixSizeMap: Record<TextSizes, RadixTextProps["size"] | undefined> = {
  small: "1",
  medium: "2",
  large: "3",
  inherit: undefined,
};

const radixWeightMap: Record<TextWeights, RadixTextProps["weight"]> = {
  regular: "regular",
  medium: "medium",
  semibold: "bold",
};

export interface TextProps {
  children: React.ReactNode;
  size?: TextSizes;
  weight?: TextWeights;
  as?: "span" | "div" | "label" | "p";

  color?: TextColors;
  align?: TextAlign;
  title?: string;

  truncate?: boolean;
  overflowWrap?: TextOverflowWrap;
  whiteSpace?: TextWhiteSpace;
  textTransform?: "uppercase" | "lowercase" | "capitalize";

  // Margin props
  m?: RadixTextProps["m"];
  mx?: RadixTextProps["mx"];
  my?: RadixTextProps["my"];
  mt?: RadixTextProps["mt"];
  mr?: RadixTextProps["mr"];
  mb?: RadixTextProps["mb"];
  ml?: RadixTextProps["ml"];
}

export default function Text({
  children,
  size = "medium",
  weight = "regular",
  as,
  color,
  align = "left",
  title,
  overflowWrap = "normal",
  whiteSpace = "normal",
  truncate = false,
  textTransform,
  m,
  mx,
  my,
  mt,
  mr,
  mb,
  ml,
}: TextProps) {
  const style: React.CSSProperties = {
    overflowWrap: overflowWrap,
    whiteSpace: whiteSpace,
  };
  if (textTransform) style.textTransform = textTransform;

  if (color === "text-high") {
    style.color = "var(--color-text-high)";
  } else if (color === "text-mid") {
    style.color = "var(--color-text-mid)";
  } else if (color === "text-low") {
    style.color = "var(--color-text-low)";
  } else if (color === "text-disabled") {
    style.color = "var(--color-text-disabled)";
  }

  return (
    <RadixText
      size={radixSizeMap[size]}
      weight={radixWeightMap[weight]}
      align={align}
      as={as}
      title={title}
      style={style}
      truncate={truncate}
      m={m}
      mx={mx}
      my={my}
      mt={mt}
      mr={mr}
      mb={mb}
      ml={ml}
    >
      {children}
    </RadixText>
  );
}
