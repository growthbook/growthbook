import { useSyncExternalStore } from "react";
import { NARROW_LAYOUT_BREAKPOINT_PX } from "./constants";

/** Keep in sync with --header-height in global.scss. */
const HEADER_HEIGHT_PX = 44;

/** The widths where the header changes height (global.scss). */
const HEIGHT_QUERIES = [`(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`];

function readHeaderHeight() {
  const height = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--header-height",
    ),
  );
  return Number.isFinite(height) ? height : HEADER_HEIGHT_PX;
}

/** Taller below 1180px on pages with the sidebar (two rows). */
export function useHeaderHeight(): number {
  return useSyncExternalStore(
    (listener) => {
      const queries = HEIGHT_QUERIES.map((q) => window.matchMedia(q));
      queries.forEach((mq) => mq.addEventListener("change", listener));
      return () =>
        queries.forEach((mq) => mq.removeEventListener("change", listener));
    },
    readHeaderHeight,
    () => HEADER_HEIGHT_PX,
  );
}
