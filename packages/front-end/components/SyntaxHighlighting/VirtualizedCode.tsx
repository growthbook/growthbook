import { RefObject, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import InlineCode, { Props as InlineCodeProps } from "./InlineCode";

// 0.85rem at line-height 1.5; wrapped lines are measured as they render
const ESTIMATED_LINE_HEIGHT = 20;

// Highlights only the lines scrolled into view, so a value thousands of lines
// long costs what its visible window costs. `scrollRef` must be the element
// that scrolls (a bounded height with overflow auto).
export default function VirtualizedCode({
  code,
  scrollRef,
  ...lineProps
}: Omit<InlineCodeProps, "firstLineNumber"> & {
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const lines = useMemo(() => code.split("\n"), [code]);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_LINE_HEIGHT,
    overscan: 10,
  });

  return (
    <div
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.index}
          data-index={item.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${item.start}px)`,
          }}
        >
          <InlineCode
            {...lineProps}
            code={lines[item.index]}
            firstLineNumber={item.index + 1}
          />
        </div>
      ))}
    </div>
  );
}
