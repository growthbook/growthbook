import { forwardRef } from "react";
import { Text as RadixText } from "@radix-ui/themes";
import type { TextProps as RadixTextProps } from "@radix-ui/themes";
import { radixSize, Size } from "@/ui/sizes";
import { useTx } from "@/services/i18n";

export type TextSizes = Size<"sm" | "md" | "lg" | "xl"> | "inherit";
export type TextWeights = "regular" | "medium" | "semibold";
type TextAlign = "left" | "center" | "right";
type TextOverflowWrap = "normal" | "anywhere" | "break-word";
type TextWhiteSpace =
  | "pre"
  | "normal"
  | "nowrap"
  | "pre-wrap"
  | "pre-line"
  | "break-spaces";
type TextFontStyle = "normal" | "italic" | "oblique";
// NB: We might need to expand this to support RadixTextProps["color"], but being conservative for now.
type TextColors = "text-high" | "text-mid" | "text-low" | "text-disabled";

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
  htmlFor?: string;

  color?: TextColors;
  align?: TextAlign;
  title?: string;

  truncate?: boolean;
  overflowWrap?: TextOverflowWrap;
  whiteSpace?: TextWhiteSpace;
  fontStyle?: TextFontStyle;
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

export default forwardRef<
  HTMLSpanElement | HTMLDivElement | HTMLLabelElement | HTMLParagraphElement,
  TextProps
>(function Text(
  {
    children,
    size = "md",
    weight = "regular",
    as,
    htmlFor,
    color,
    align = "left",
    title,
    overflowWrap = "normal",
    whiteSpace = "normal",
    fontStyle = "normal",
    truncate = false,
    textTransform,
    m,
    mx,
    my,
    mt,
    mr,
    mb,
    ml,
  },
  ref,
) {
  const tx = useTx();
  const style: React.CSSProperties = {
    overflowWrap,
    fontStyle,
    // Only set whiteSpace inline when truncate is off; otherwise let
    // Radix's .rt-truncate class apply `white-space: nowrap`.
    ...(truncate ? {} : { whiteSpace }),
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
      ref={ref}
      size={size === "inherit" ? undefined : radixSize(size)}
      weight={radixWeightMap[weight]}
      align={align}
      as={as}
      title={title}
      htmlFor={htmlFor}
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
      {tx(children)}
    </RadixText>
  );
});
