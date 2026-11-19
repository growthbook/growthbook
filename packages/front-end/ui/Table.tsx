import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Box, Table as RadixTable } from "@radix-ui/themes";
import clsx from "clsx";
import { radixSize, Size } from "@/ui/sizes";
import ScrollArea from "@/ui/ScrollArea";
import { usePageTopOffset } from "@/components/Layout/pageTopOffset";
import styles from "./Table.module.scss";

export type TableProps = Omit<
  React.ComponentProps<typeof RadixTable.Root>,
  "variant" | "size"
> & {
  /** "list" enables list-table wrapper, scroll, and styling; "surface" | "ghost" are passed to Radix */
  variant?: "list" | "surface" | "ghost";
  size?: Size<"sm" | "md" | "lg">;
  /** When true (or when variant="list"), header row is sticky; when false, list variant keeps styling but header does not stick */
  stickyHeader?: boolean;
  /** Top offset in px for sticky header (default: under the app header and whatever the page pins there, --page-sticky-top). Used as CSS var --table-sticky-top. */
  stickyTopOffset?: number;
  /** When true (or when variant="list"), first header row gets rounded top corners */
  roundedCorners?: boolean;
  /**
   * Opt in to a bounded scroll region so wide tables scroll horizontally. The
   * header then sticks to that region instead of the viewport — the list variant
   * neutralises Radix's own scroll area to get viewport-sticky headers, and
   * overflow-x can't scroll without overflow-y doing the same. Other variants
   * scroll sideways in a ScrollArea once narrower than their `minWidth`.
   */
  scrollX?: boolean;
  /** Pins the last column to the right edge while the rest scrolls under it, in a `scrollX` region or once the table is too wide for the page. */
  stickyLastColumn?: boolean;
  /** For a tall `scrollX` table: its sideways scrollbar sticks to the window's bottom, and the wheel is left to scroll the page. */
  pinScrollbar?: boolean;
  /**
   * Height cap for the `scrollX` region, e.g. 480 or "60vh". Without it the
   * region grows to the viewport, which pushes anything below the table (such
   * as pagination) out of view.
   */
  maxHeight?: number | string;
  /**
   * px floor for the table itself. Under a fixed layout a column with no width
   * takes only the leftover space, so without a floor it collapses to zero once
   * the specified widths fill the container. `useTableColumns` computes this.
   */
  minTableWidth?: number;
};

// The element a `scrollX` table scrolls sideways in, for TableViewportCell.
const TableScrollContext = createContext<HTMLDivElement | null>(null);

function tableScroller(cell: HTMLElement): HTMLElement | null {
  // A TableViewportCell's content already follows the scroll.
  if (cell.hasAttribute("data-viewport-cell")) return null;
  let scroller = cell.parentElement;
  while (scroller && scroller.scrollWidth <= scroller.clientWidth) {
    scroller = scroller.parentElement;
  }
  return scroller && scroller !== document.documentElement ? scroller : null;
}

// Shows the cell in full beside a pinned last column, or from its left edge
// when it's wider than the room. Returns whether it scrolled.
function scrollIntoTable(cell: HTMLElement, scroller: HTMLElement): boolean {
  const pinned = cell.parentElement?.lastElementChild;
  const isPinned = (e: Element | null | undefined): e is HTMLElement =>
    e instanceof HTMLElement && getComputedStyle(e).position === "sticky";
  // A pinned cell is always in view.
  if (pinned === cell && isPinned(cell)) return false;
  const pinnedWidth = isPinned(pinned)
    ? pinned.getBoundingClientRect().width
    : 0;
  const box = scroller.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  let delta = Math.max(0, rect.right - (box.right - pinnedWidth));
  if (rect.left - delta < box.left) delta = rect.left - box.left;
  if (Math.abs(delta) < 1) return false;
  scroller.scrollBy({ left: delta, behavior: "smooth" });
  return true;
}

// Per table: where it scrolls back to once its open editors close.
const scrollBacks = new WeakMap<
  HTMLElement,
  { left: number; open: number; moved: boolean; frame: number }
>();

// Brings an editor's cell into view and returns what scrolls back. That waits a
// frame, so an editor opening as another closes takes the scroll-back over.
export function revealTableCell(cell: HTMLElement): () => void {
  const scroller = tableScroller(cell);
  if (!scroller) return () => {};
  const state = scrollBacks.get(scroller) ?? {
    left: scroller.scrollLeft,
    open: 0,
    moved: false,
    frame: 0,
  };
  scrollBacks.set(scroller, state);
  cancelAnimationFrame(state.frame);
  state.open++;
  state.moved = scrollIntoTable(cell, scroller) || state.moved;
  return () => {
    state.open--;
    if (state.open > 0) return;
    state.frame = requestAnimationFrame(() => {
      scrollBacks.delete(scroller);
      if (state.moved) {
        scroller.scrollTo({ left: state.left, behavior: "smooth" });
      }
    });
  };
}

export default function Table({
  children,
  variant,
  size,
  stickyHeader,
  stickyTopOffset,
  roundedCorners,
  scrollX,
  stickyLastColumn,
  pinScrollbar,
  maxHeight,
  minTableWidth,
  className,
  m,
  mx,
  my,
  mt,
  mr,
  mb,
  ml,
  ...props
}: TableProps) {
  const margins = { m, mx, my, mt, mr, mb, ml };
  const isListVariant =
    variant === "list" || stickyHeader === true || roundedCorners === true;
  const useStickyHeader =
    (variant === "list" && stickyHeader !== false) || stickyHeader === true;

  const wrapperRef = useRef<HTMLDivElement>(null);
  // Too wide for the page, the table scrolls sideways in its own box. Not
  // with scrollX, already a scroll region.
  const [autoScroll, setAutoScroll] = useState(false);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const table = wrapper?.querySelector("table");
    if (!isListVariant || scrollX || !wrapper || !table) {
      setAutoScroll(false);
      return;
    }
    const check = () =>
      setAutoScroll(table.offsetWidth > wrapper.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(wrapper);
    observer.observe(table);
    return () => observer.disconnect();
  }, [isListVariant, scrollX]);

  // Written to the DOM directly, so scrolling doesn't re-render.
  const isScrollBox = !!scrollX || autoScroll;
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!isScrollBox || !wrapper) return;
    const flagHiddenEdges = () => {
      const hidden = wrapper.scrollWidth - wrapper.clientWidth;
      wrapper.toggleAttribute("data-more-start", wrapper.scrollLeft > 1);
      wrapper.toggleAttribute("data-more-end", hidden - wrapper.scrollLeft > 1);
    };
    const measure = () => {
      wrapper.style.setProperty(
        "--table-scroll-height",
        `${wrapper.clientHeight}px`,
      );
      wrapper.style.setProperty(
        "--table-box-height",
        `${wrapper.getBoundingClientRect().height}px`,
      );
      flagHiddenEdges();
    };
    measure();
    wrapper.addEventListener("scroll", flagHiddenEdges, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    const table = wrapper.querySelector("table");
    if (table) observer.observe(table);
    return () => {
      wrapper.removeEventListener("scroll", flagHiddenEdges);
      observer.disconnect();
      wrapper.removeAttribute("data-more-start");
      wrapper.removeAttribute("data-more-end");
      wrapper.style.removeProperty("--table-scroll-height");
      wrapper.style.removeProperty("--table-box-height");
    };
  }, [isScrollBox]);

  // --table-sticky-top resolves against the page's top offset.
  const pageTopOffset = usePageTopOffset();

  // A sideways scroll box can't let its header stick to the window, so the
  // header is moved down the box as the page scrolls instead. CSS does that
  // with a scroll-driven animation; this is for browsers without one.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!autoScroll || !useStickyHeader || !wrapper) return;
    const style = getComputedStyle(wrapper);
    // Set by the stylesheet where its animation applies.
    if (style.getPropertyValue("--table-header-scroll-driven")) return;
    let frame = 0;
    // scroll-margin-top carries --table-sticky-top, resolved to px.
    let stickTop = parseFloat(style.scrollMarginTop);
    const update = () => {
      frame = 0;
      const box = wrapper.getBoundingClientRect();
      // The header starts under the box's 1px border.
      const shift = Math.min(box.height, Math.max(0, stickTop - 1 - box.top));
      wrapper.style.setProperty("--table-header-shift", `${shift}px`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onResize = () => {
      stickTop = parseFloat(style.scrollMarginTop);
      onScroll();
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      wrapper.style.removeProperty("--table-header-shift");
    };
  }, [autoScroll, useStickyHeader, stickyTopOffset, pageTopOffset]);

  useEffect(() => {
    if (!isListVariant || !useStickyHeader) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // In a scroll region the header is always stuck to the region's top, so
    // there is no unstuck state to detect. In a sideways scroll box
    // (autoScroll) the box keeps its corners while the header moves in it.
    if (autoScroll) {
      wrapper.removeAttribute("data-sticky-active");
      return;
    }
    if (scrollX) {
      wrapper.setAttribute("data-sticky-active", "true");
      return;
    }
    const header = wrapper.querySelector<HTMLElement>(".rt-TableHeader");
    if (!header) return;

    const style = getComputedStyle(header);
    // Where it sticks: --table-sticky-top, resolved to px.
    let stickTop = parseFloat(style.top);
    const check = () => {
      const isSticky =
        Math.abs(header.getBoundingClientRect().top - stickTop) < 2;
      if (isSticky) {
        wrapper.setAttribute("data-sticky-active", "true");
      } else {
        wrapper.removeAttribute("data-sticky-active");
      }
    };
    const onResize = () => {
      stickTop = parseFloat(style.top);
      check();
    };

    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", onResize);
    };
  }, [
    isListVariant,
    useStickyHeader,
    stickyTopOffset,
    scrollX,
    autoScroll,
    pageTopOffset,
  ]);

  // State, not a ref: the scroll box arrives after its cells' first effects.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // Whatever takes focus in a sideways-scrolling table comes into view, past
  // the pinned column rather than under it.
  const pinnedScroll = !isListVariant && !!scrollX && !!stickyLastColumn;
  useEffect(() => {
    if (!pinnedScroll || !scroller) return;
    const onFocus = (e: FocusEvent) => {
      const cell =
        e.target instanceof Element ? e.target.closest("td, th") : null;
      if (cell instanceof HTMLElement && scroller.contains(cell)) {
        const box = tableScroller(cell);
        if (box) scrollIntoTable(cell, box);
      }
    };
    scroller.addEventListener("focusin", onFocus);
    return () => scroller.removeEventListener("focusin", onFocus);
  }, [pinnedScroll, scroller]);

  const radixVariant = variant === "list" ? "surface" : variant;

  const tableElement = (
    <RadixTable.Root
      {...props}
      // The list wrapper carries the margins instead, outside its outline.
      {...(isListVariant ? {} : margins)}
      // The list wrapper carries the floor instead, where a drag-resize moves it.
      style={
        !isListVariant && minTableWidth
          ? ({
              ...props.style,
              "--table-min-width": `${minTableWidth}px`,
            } as React.CSSProperties)
          : props.style
      }
      variant={radixVariant}
      size={size !== undefined ? radixSize(size) : undefined}
      className={clsx(className, isListVariant && styles.tableList)}
    >
      {children}
    </RadixTable.Root>
  );

  if (!isListVariant) {
    if (!scrollX) return tableElement;
    return (
      <TableScrollContext.Provider value={scroller}>
        <ScrollArea
          ref={setScroller}
          direction="horizontal"
          size="md"
          gutter
          // A tall table leaves the wheel to the page but over its scrollbar.
          wheelScrollsSideways={pinScrollbar ? "scrollbar" : "area"}
          pinScrollbar={pinScrollbar}
          edgeCue="fade"
          // A pinned column fades what's under it itself, above the row
          // borders a mask would fade too; the left edge goes unmarked to match.
          skipEdges={stickyLastColumn ? ["left", "right"] : []}
          className={clsx(
            styles.scrollPlain,
            stickyLastColumn && styles.pinLastColumn,
          )}
        >
          {tableElement}
        </ScrollArea>
      </TableScrollContext.Provider>
    );
  }

  return (
    <Box
      {...margins}
      ref={wrapperRef}
      className={styles.wrapper}
      style={
        {
          ...(useStickyHeader && {
            "--table-sticky-top":
              stickyTopOffset !== undefined
                ? `${stickyTopOffset}px`
                : "var(--page-sticky-top, var(--page-top-offset))",
          }),
          ...(minTableWidth && { "--table-min-width": `${minTableWidth}px` }),
          ...(maxHeight !== undefined && {
            "--table-max-height":
              typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
          }),
        } as React.CSSProperties
      }
      data-table-list
      data-sticky-header={useStickyHeader ? "true" : "false"}
      data-scroll-x={scrollX ? "true" : undefined}
      data-sticky-last-column={
        isScrollBox && stickyLastColumn ? "true" : undefined
      }
      data-auto-scroll={autoScroll ? "true" : undefined}
    >
      {tableElement}
    </Box>
  );
}

export function TableHeader({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.Header>) {
  return <RadixTable.Header {...props}>{children}</RadixTable.Header>;
}

export function TableBody({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.Body>) {
  return <RadixTable.Body {...props}>{children}</RadixTable.Body>;
}

export const TableRow = forwardRef<
  HTMLTableRowElement,
  React.ComponentProps<typeof RadixTable.Row>
>(function TableRow({ children, ...props }, ref) {
  return (
    <RadixTable.Row ref={ref} {...props}>
      {children}
    </RadixTable.Row>
  );
});

export function TableRowHeaderCell({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.RowHeaderCell>) {
  return (
    <RadixTable.RowHeaderCell {...props}>{children}</RadixTable.RowHeaderCell>
  );
}

export function TableColumnHeader({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.ColumnHeaderCell>) {
  return (
    <RadixTable.ColumnHeaderCell {...props}>
      {children}
    </RadixTable.ColumnHeaderCell>
  );
}

// A full-row cell (give it the row's colSpan) whose content spans the visible
// width and stays put while the table scrolls sideways, e.g. an inline editor.
export function TableViewportCell({
  children,
  ...props
}: React.ComponentProps<typeof RadixTable.Cell>) {
  const viewport = useContext(TableScrollContext);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const cell = cellRef.current;
    if (!cell || !viewport) return;
    const measure = () => {
      const { paddingLeft, paddingRight } = getComputedStyle(cell);
      const left = parseFloat(paddingLeft);
      setBox({
        left,
        width: viewport.clientWidth - left - parseFloat(paddingRight),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);
  return (
    <RadixTable.Cell ref={cellRef} data-viewport-cell {...props}>
      <div
        style={
          box
            ? { position: "sticky", left: box.left, width: box.width }
            : undefined
        }
      >
        {children}
      </div>
    </RadixTable.Cell>
  );
}

export const TableCell = forwardRef<
  HTMLTableCellElement,
  React.ComponentProps<typeof RadixTable.Cell>
>(function TableCell({ children, ...props }, ref) {
  return (
    <RadixTable.Cell ref={ref} {...props}>
      {children}
    </RadixTable.Cell>
  );
});
