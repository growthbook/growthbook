import { useRef } from "react";
import { Text as RadixText } from "@radix-ui/themes";
import { useIsOverflowingX } from "@/hooks/useIsOverflowing";
import { radixSize } from "@/ui/sizes";
import { radixWeightMap, TextColors, TextSizes, TextWeights } from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

/**
 * Text cut off with an ellipsis where it runs out of room, with all of it in a
 * tooltip once it is. Focusable then, so a keyboard can open it too. Styled
 * as `Text` is, on Radix's own so the tooltip can hold it.
 */
export default function TruncatedText({
  text,
  maxWidth,
  size = "inherit",
  weight = "regular",
  color,
}: {
  text: string;
  /** Inline, up to this width; without it, as wide as its container. */
  maxWidth?: number | string;
  size?: TextSizes;
  weight?: TextWeights;
  color?: TextColors;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const truncated = useIsOverflowingX(ref, true, text);
  return (
    <Tooltip content={text} enabled={truncated}>
      <RadixText
        ref={ref}
        as="span"
        truncate
        size={size === "inherit" ? undefined : radixSize(size)}
        weight={radixWeightMap[weight]}
        tabIndex={truncated ? 0 : undefined}
        style={{
          display: maxWidth === undefined ? "block" : "inline-block",
          maxWidth,
          minWidth: 0,
          verticalAlign: "bottom",
          color: color && `var(--color-${color})`,
        }}
      >
        {text}
      </RadixText>
    </Tooltip>
  );
}
