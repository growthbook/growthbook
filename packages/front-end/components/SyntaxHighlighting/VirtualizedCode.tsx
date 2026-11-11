import {
  createContext,
  RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import InlineCode, { Props as InlineCodeProps } from "./InlineCode";

// 0.8rem at line-height 1.5, until a rendered line gives the real metrics
const ESTIMATED_LINE_HEIGHT = 19;

// How many rows a line wraps to when `charsPerRow` monospace characters fit
// across the box: wrapped at spaces, as pre-wrap does, and a word too long
// for a row broken across rows. Close enough that measuring rows as they
// render barely moves the content, where a flat one-row guess makes it jump
// and keeps pushing the end away while scrolling.
export function wrappedRows(line: string, charsPerRow: number | null): number {
  if (!charsPerRow || charsPerRow < 1) return 1;
  let rows = 1;
  let column = 0;
  for (const word of line.split(" ")) {
    if (column > 0 && column + word.length > charsPerRow) {
      rows++;
      column = 0;
    }
    column += word.length;
    while (column > charsPerRow) {
      rows++;
      column -= charsPerRow;
    }
    // The space after a word hangs at the row's end rather than wrapping.
    column = Math.min(column + 1, charsPerRow);
  }
  return rows;
}

interface Metrics {
  rowHeight: number;
  charsPerRow: number;
}

// A rendered line's row height and how many characters fit on a row.
function measureMetrics(box: HTMLElement): Metrics | null {
  // The row's block, full width; the code inside is only as wide as its text.
  const row = box.querySelector("pre");
  const code = row?.querySelector("code");
  if (!row || !code) return null;
  const style = getComputedStyle(code);
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const charWidth = context.measureText("0").width;
  const rowHeight = parseFloat(style.lineHeight);
  if (!charWidth || !rowHeight) return null;
  return {
    rowHeight,
    charsPerRow: Math.floor(row.clientWidth / charWidth),
  };
}

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
  const boxRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) =>
      (metrics?.rowHeight ?? ESTIMATED_LINE_HEIGHT) *
      wrappedRows(lines[i], metrics?.charsPerRow ?? null),
    overscan: 10,
  });

  // Re-measured when the box's width changes, which moves where lines wrap.
  // Its height changes on most scrolls, which moves nothing.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let measuredWidth: number | null = null;
    const update = () => {
      if (box.clientWidth === measuredWidth) return;
      const next = measureMetrics(box);
      if (!next) return;
      measuredWidth = box.clientWidth;
      setMetrics((prev) =>
        next.rowHeight !== prev?.rowHeight ||
        next.charsPerRow !== prev?.charsPerRow
          ? next
          : prev,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  // New estimates apply to rows not yet measured. Clearing the stale ones
  // clears the rows on screen too, which are measured again from the page.
  useLayoutEffect(() => {
    if (!metrics) return;
    virtualizer.measure();
    boxRef.current
      ?.querySelectorAll<HTMLElement>("[data-index]")
      .forEach((row) => virtualizer.measureElement(row));
  }, [metrics, virtualizer]);

  // Rows stay in normal flow between spacers, rather than absolutely
  // positioned, so the code still has a width inside shrink-to-fit layouts
  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);

  return (
    <div ref={boxRef} style={{ paddingTop, paddingBottom }}>
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
