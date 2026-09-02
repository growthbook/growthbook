import React, { useRef, useState } from "react";
import styles from "./Table.module.scss";

const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_LARGE = 64;

/**
 * Width of a cell's laid-out content. Text is measured through Ranges and only
 * inline-level boxes count, so a block wrapper that fills the cell (a clamp, a
 * flex row) doesn't report the cell's own width back as "content".
 */
function contentWidth(cell: Element, skip: Element | null): number {
  let left = Infinity;
  let right = -Infinity;
  const include = ({ left: l, right: r, width }: DOMRect) => {
    if (width <= 0) return;
    left = Math.min(left, l);
    right = Math.max(right, r);
  };
  const walker = document.createTreeWalker(
    cell,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node === skip ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (getComputedStyle(node).display.startsWith("inline")) {
        include(node.getBoundingClientRect());
      }
    } else {
      const range = document.createRange();
      range.selectNodeContents(node);
      include(range.getBoundingClientRect());
    }
  }
  return right > left ? right - left : 0;
}

export default function ColumnResizeHandle({
  label,
  width,
  minWidth,
  maxWidth,
  onCommit,
  setLiveWidth,
}: {
  label: string;
  /** Committed width, or undefined when the column is auto-sized. */
  width: number | undefined;
  minWidth: number;
  maxWidth: number;
  onCommit: (width: number | undefined) => void;
  /** Written imperatively during the drag; no React render per frame. */
  setLiveWidth: (width: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    startX: number;
    startWidth: number;
    pending: number;
    raf: number | null;
    moved: boolean;
  } | null>(null);
  // Only the slack column has no width to report. Measured on focus, which is
  // when a screen reader announces the value.
  const [focusWidth, setFocusWidth] = useState<number | undefined>();

  // Measured from the header cell, so it's truthful even for an auto-sized
  // column that has no width of its own.
  const measure = () =>
    ref.current?.closest("th")?.getBoundingClientRect().width ?? 0;

  const clamp = (w: number) => Math.min(Math.max(w, minWidth), maxWidth);

  const flush = () => {
    const state = drag.current;
    if (!state) return;
    state.raf = null;
    setLiveWidth(state.pending);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // The sort handler lives on an inner span of the same <th>, but stop
    // propagation anyway so a drag can never register as a sort click.
    e.preventDefault();
    e.stopPropagation();
    const startWidth = measure();
    drag.current = {
      startX: e.clientX,
      startWidth,
      pending: clamp(startWidth),
      raf: null,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.active = "true";
    const wrapper = e.currentTarget.closest("[data-table-list]");
    wrapper?.setAttribute("data-resizing", "true");
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;
    state.moved = true;
    state.pending = clamp(state.startWidth + (e.clientX - state.startX));
    if (state.raf === null) state.raf = requestAnimationFrame(flush);
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;
    if (state.raf !== null) cancelAnimationFrame(state.raf);
    if (state.moved) flush();
    drag.current = null;
    delete e.currentTarget.dataset.active;
    e.currentTarget
      .closest("[data-table-list]")
      ?.removeAttribute("data-resizing");
    // A click that never moved must not pin the column: committing there would
    // freeze the slack column and mark the layout customized.
    if (state.moved) onCommit(state.pending);
  };

  // Spreadsheet semantics: size the column to its widest header or cell content.
  const fitToContent = () => {
    const th = ref.current?.closest("th");
    const table = th?.closest("table");
    if (!th || !table) return;
    const index = Array.from(th.parentElement?.children ?? []).indexOf(th);
    const cells = Array.from(table.querySelectorAll("tbody tr"))
      .map((row) => row.children[index])
      .filter((cell): cell is Element => !!cell);
    const style = getComputedStyle(th);
    const padding =
      parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const widest = Math.max(
      ...[th, ...cells].map((cell) => contentWidth(cell, ref.current)),
    );
    onCommit(clamp(Math.ceil(widest + padding)));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const from = width ?? measure();
      onCommit(clamp(from + (e.key === "ArrowRight" ? step : -step)));
    } else if (e.key === "Home") {
      e.preventDefault();
      onCommit(undefined);
    }
  };

  return (
    <button
      ref={ref}
      type="button"
      className={styles.resizeHandle}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuenow={width ?? focusWidth}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      onFocus={() => setFocusWidth(Math.round(measure()) || undefined)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        fitToContent();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
