import { Box } from "@radix-ui/themes";
import React, { useEffect, useRef, useState } from "react";
import Link from "@/ui/Link";
import styles from "./ExpandableContent.module.scss";

export interface ExpandableContentProps {
  maxHeight: number;
  children: React.ReactNode;
  expandLabel?: string;
  collapseLabel?: string;
  fadeColor?: string;
}

/**
 * Height-capped wrapper with a fade-out and a "Show more"/"Show less" toggle.
 * Only collapses when the content actually overflows; a ResizeObserver re-checks
 * as content reflows.
 */
export default function ExpandableContent({
  maxHeight,
  children,
  expandLabel = "Show more",
  collapseLabel = "Show less",
  fadeColor = "var(--color-panel-solid)",
}: ExpandableContentProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight > maxHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight]);

  return (
    <>
      <Box
        style={
          !expanded && overflowing
            ? { position: "relative", maxHeight, overflow: "hidden" }
            : { position: "relative" }
        }
      >
        <Box ref={contentRef}>{children}</Box>
        {!expanded && overflowing && (
          <div
            className={styles.fadeOverlay}
            style={{
              background: `linear-gradient(transparent, ${fadeColor})`,
            }}
          />
        )}
      </Box>
      {overflowing && (
        <Box mt="2">
          <Link onClick={() => setExpanded((v) => !v)}>
            {expanded ? collapseLabel : expandLabel}
          </Link>
        </Box>
      )}
    </>
  );
}
