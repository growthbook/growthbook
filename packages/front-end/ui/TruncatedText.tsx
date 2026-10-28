import { useRef } from "react";
import { useIsOverflowingX } from "@/hooks/useIsOverflowing";
import Tooltip from "@/ui/Tooltip";

/**
 * Text cut off with an ellipsis where it runs out of room, with all of it in a
 * tooltip once it is. Focusable then, so a keyboard can open it too.
 */
export default function TruncatedText({
  text,
  maxWidth,
  strong = false,
}: {
  text: string;
  /** Inline, up to this width; without it, as wide as its container. */
  maxWidth?: number | string;
  strong?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const truncated = useIsOverflowingX(ref, true, text);
  const Tag = strong ? "strong" : "span";
  return (
    <Tooltip content={text} enabled={truncated}>
      <Tag
        ref={ref}
        tabIndex={truncated ? 0 : undefined}
        style={{
          display: maxWidth === undefined ? "block" : "inline-block",
          maxWidth,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          verticalAlign: "bottom",
        }}
      >
        {text}
      </Tag>
    </Tooltip>
  );
}
