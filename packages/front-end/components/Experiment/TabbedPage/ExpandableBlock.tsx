import { ReactNode, useRef, useState } from "react";
import { Box } from "@radix-ui/themes";
import useIsOverflowing from "@/hooks/useIsOverflowing";
import Link from "@/ui/Link";

const MAX_HEIGHT = 150;

// Content past MAX_HEIGHT fades out at the bottom, with a link to the rest.
export default function ExpandableBlock({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const overflows = useIsOverflowing(content, MAX_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const clamped = overflows && !expanded;

  return (
    <Box>
      <Box
        className={clamped ? "fade-mask-bottom-1rem" : undefined}
        style={{
          maxHeight: expanded
            ? undefined
            : `calc(${MAX_HEIGHT}px + 2 * var(--space-1))`,
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
