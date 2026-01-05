import { Text as RadixText } from "@radix-ui/themes";
import type { TextProps as RadixTextProps } from "@radix-ui/themes";

type TextSizes = "small" | "medium" | "large";
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
type TextColors =
  | "text-high"
  | "text-mid"
  | "text-low"
  | RadixTextProps["color"];

const radixSizeMap: Record<TextSizes, RadixTextProps["size"]> = {
  small: "1",
  medium: "2",
  large: "3",
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
  color = "text-mid",
  align = "left",
  title,
  overflowWrap = "normal",
  whiteSpace = "normal",
  truncate = false,
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

  let colorProp: RadixTextProps["color"] | undefined;
  if (color === "text-high") {
    style.color = "var(--color-text-high)";
  } else if (color === "text-mid") {
    style.color = "var(--color-text-mid)";
  } else if (color === "text-low") {
    style.color = "var(--color-text-low)";
  } else {
    colorProp = color;
  }

  return (
    <RadixText
      size={radixSizeMap[size]}
      weight={radixWeightMap[weight]}
      align={align}
      as={as}
      title={title}
      color={colorProp}
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
