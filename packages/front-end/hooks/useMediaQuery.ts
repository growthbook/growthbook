import { useEffect, useState } from "react";

/**
 * True while the CSS media query matches. Fires only when the boundary is
 * crossed, unlike a resize listener, which fires on every frame of a drag.
 */
export default function useMediaQuery(query: string): boolean {
  // Read up front so the first paint is already on the right side.
  const [matches, setMatches] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);

  return matches;
}
