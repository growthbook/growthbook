import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { Box } from "@radix-ui/themes";
import useIsOverflowing from "@/hooks/useIsOverflowing";
import Link from "@/ui/Link";

const DEFAULT_MAX_HEIGHT = 150;

// Content past maxHeight fades out, with a link to the rest.
export default function ExpandableBlock({
  children,
  maxHeight = DEFAULT_MAX_HEIGHT,
  defaultExpanded = false,
  bleed = false,
}: {
  children: ReactNode;
  maxHeight?: number;
  defaultExpanded?: boolean;
  // Negative margin so a parent's hover tint can bleed past this block.
  bleed?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const overflows = useIsOverflowing(content, maxHeight);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const clamped = overflows && !expanded;

  useEffect(() => {
    if (defaultExpanded) setExpanded(true);
  }, [defaultExpanded]);

  return (
    <Box>
      <Box
        id={contentId}
        className={clamped ? "fade-mask-bottom-1rem" : undefined}
        style={{
          maxHeight: expanded
            ? undefined
            : bleed
              ? `calc(${maxHeight}px + 2 * var(--space-1))`
              : maxHeight,
          overflow: "hidden",
          // Room for a row's hover tint, which reaches past the row
          // (hover-highlight's default bleed), without moving the contents.
          ...(bleed
            ? {
                margin: "calc(-1 * var(--space-1)) calc(-1 * var(--space-2))",
                padding: "var(--space-1) var(--space-2)",
              }
            : {}),
        }}
      >
        <div ref={content}>{children}</div>
      </Box>
      {overflows ? (
        <Link
          size="sm"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show less" : "Show more"}
        </Link>
      ) : null}
    </Box>
  );
}
