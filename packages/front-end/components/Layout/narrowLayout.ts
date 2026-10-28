import { useSyncExternalStore } from "react";

// Below 1180px the side nav is a drawer (AppRail.module.scss) and the header
// takes two rows (TopNav.module.scss).
export const NARROW_LAYOUT_QUERY = "(max-width: 1180px)";

// Whether the window is below 1180px now. False on the server and on the
// first render, as the side nav's own check.
export function useNarrowLayout(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const mq = window.matchMedia(NARROW_LAYOUT_QUERY);
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    },
    () => window.matchMedia(NARROW_LAYOUT_QUERY).matches,
    () => false,
  );
}
