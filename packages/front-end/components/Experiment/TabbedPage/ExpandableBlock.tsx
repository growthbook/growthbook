import { ReactNode, useRef, useState } from "react";
import { Box } from "@radix-ui/themes";
import useIsOverflowing from "@/hooks/useIsOverflowing";
import Link from "@/ui/Link";

/**
 * Content held to `maxHeight`: when it runs longer, the bottom fades out and a
 * link opens the rest. Content that fits shows as it is.
 */
export default function ExpandableBlock({
  maxHeight = 150,
  children,
}: {
  maxHeight?: number;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const overflows = useIsOverflowing(content, maxHeight);
  const [expanded, setExpanded] = useState(false);
  const clamped = overflows && !expanded;

  return (
    <Box>
      <Box
        className={clamped ? "fade-mask-bottom-1rem" : undefined}
        style={{
          maxHeight: expanded
            ? undefined
            : `calc(${maxHeight}px + 2 * var(--space-1))`,
          overflow: "hidden",
          // Room for a row's hover tint, which reaches past the row
          // (hover-highlight's default bleed), without moving the contents.
          margin: "calc(-1 * var(--space-1)) calc(-1 * var(--space-2))",
          padding: "var(--space-1) var(--space-2)",
        }}
      >
        <div ref={content}>{children}</div>
      </Box>
      {overflows ? (
        <Link size="sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Collapse" : "Expand..."}
        </Link>
      ) : null}
    </Box>
  );
}
