import React from "react";
import clsx from "clsx";
import Tooltip from "@/ui/Tooltip";

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // Need at least 2 chars to show "head…tail"; otherwise avoid slice(-0) bug
  if (maxChars < 2) return "\u2026";
  const head = Math.floor((maxChars - 1) / 2);
  const tail = maxChars - 1 - head;
  const tailPart = tail > 0 ? text.slice(-tail) : "";
  return `${text.slice(0, head)}\u2026${tailPart}`;
}

export type TruncateMiddleWithTooltipProps = {
  /** Full text to display; shown truncated in the middle when over maxChars. */
  text: string;
  /** Max width for the container (e.g. 120 or "8rem"). */
  maxWidth?: number | string;
  /** Max characters before middle truncation (default 24). */
  maxChars?: number;
  className?: string;
};

/**
 * Renders text with middle truncation (start…end) and shows full text in a
 * tooltip on hover. Use in table cells (including Radix Table) or any list.
 */
export function TruncateMiddleWithTooltip({
  text,
  maxWidth,
  maxChars = 24,
  className,
}: TruncateMiddleWithTooltipProps) {
  const truncated = truncateMiddle(text, maxChars);
  const isTruncated = truncated !== text;

  const style: React.CSSProperties | undefined = maxWidth
    ? { maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth }
    : undefined;

  const span = (
    <span
      className={clsx("truncate", className)}
      style={style}
      title={undefined}
    >
      {truncated}
    </span>
  );

  if (isTruncated) {
    return <Tooltip content={text}>{span}</Tooltip>;
  }

  return span;
}
