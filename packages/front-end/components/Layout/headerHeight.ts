import { useSyncExternalStore } from "react";
import { NARROW_LAYOUT_BREAKPOINT_PX } from "./constants";

/** Keep in sync with --header-height in global.scss. */
const HEADER_HEIGHT_PX = 56;

/** The width where the header changes height (global.scss). */
const HEIGHT_QUERY = `(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`;

// Module scope: a new function each render makes React resubscribe and
// re-read the snapshot after every commit, which forces a style recalc.
function subscribe(listener: () => void) {
  const query = window.matchMedia(HEIGHT_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

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
    subscribe,
    readHeaderHeight,
    () => HEADER_HEIGHT_PX,
  );
}
