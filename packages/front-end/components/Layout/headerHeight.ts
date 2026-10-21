import { useSyncExternalStore } from "react";

// The app header's height (TopNav and TopNavLite). Keep in sync with
// --header-height in global.scss.
export const HEADER_HEIGHT_PX = 44;

// Below 1180px, beside the side nav's drawer: two rows (TopNav.module.scss).
export const HEADER_HEIGHT_TWO_ROWS_PX = 80;

const TWO_ROWS_QUERY = "(max-width: 1180px)";

function readHeaderHeight() {
  const height = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--header-height",
    ),
  );
  return Number.isFinite(height) ? height : HEADER_HEIGHT_PX;
}

// The header's height now: taller below 1180px on pages with the side nav.
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
