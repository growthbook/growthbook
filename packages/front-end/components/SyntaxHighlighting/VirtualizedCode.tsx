import {
  createContext,
  RefObject,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import InlineCode, { Props as InlineCodeProps } from "./InlineCode";

// 0.85rem at line-height 1.5; wrapped lines are measured as they render
const ESTIMATED_LINE_HEIGHT = 20;

// Inside it, long code and large diffs render in full: for offscreen renders
// that are read back as text, such as Copy as → Formatted changes
export const RenderInFullContext = createContext(false);

// A parent's ref is attached after its children's layout effects, so a
// virtualizer mounted together with its scroll box first sees no scroll
// element. One render after mount lets it pick the box up.
export function useRenderAfterParentRefs() {
  const [, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);
}

// Code longer than this is worth virtualizing inside a scrolling box
export function isLongCode(code: string): boolean {
  return code.split("\n").length > 50;
}

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
  useRenderAfterParentRefs();
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_LINE_HEIGHT,
    overscan: 10,
  });

  // Rows stay in normal flow between spacers, rather than absolutely
  // positioned, so the code still has a width inside shrink-to-fit layouts
  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);

  return (
    <div style={{ paddingTop, paddingBottom }}>
      {items.map((item) => (
        <div
          key={item.index}
          data-index={item.index}
          ref={virtualizer.measureElement}
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
