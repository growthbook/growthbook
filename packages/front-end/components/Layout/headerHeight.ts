import { useSyncExternalStore } from "react";
import { NARROW_LAYOUT_BREAKPOINT_PX } from "./constants";

/** Keep in sync with --header-height in global.scss. */
const HEADER_HEIGHT_PX = 44;

const TWO_ROWS_QUERY = `(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`;

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
      const mq = window.matchMedia(TWO_ROWS_QUERY);
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    },
    readHeaderHeight,
    () => HEADER_HEIGHT_PX,
  );
}

/**
 * 1px under the header, so pinned tabs cover its edge. Keep in sync with
 * --tabs-top in global.scss.
 */
export function useTabsTop(): number {
  return useHeaderHeight() - 1;
}

/** Keep in sync with --tabs-bar-height in global.scss. */
const TABS_BAR_HEIGHT_PX = 40;

/** Keep in sync with --tabs-bottom in global.scss. */
export function useTabsBottom(): number {
  return useTabsTop() + TABS_BAR_HEIGHT_PX;
}
