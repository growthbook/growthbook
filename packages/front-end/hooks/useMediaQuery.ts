import { useCallback, useSyncExternalStore } from "react";

/**
 * True while the media query matches; re-renders only when that flips. Right
 * from the first paint, except a server-rendered page, which hydrates as not
 * matching and then catches up.
 */
export default function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener("change", onChange);
      return () => mq?.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => !!window.matchMedia?.(query).matches,
    () => false,
  );
}
