import { useEffect, useState } from "react";

/**
 * True while the CSS media query matches. Fires only when the boundary is
 * crossed, unlike a resize listener, which fires on every frame of a drag.
 */
export function useMediaQuery(query: string): boolean {
  // Read on the first render where there is a window, so a layout that loads
  // already past the boundary doesn't paint the other side of it first.
  const [matches, setMatches] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export default useMediaQuery;
