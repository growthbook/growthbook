import { useEffect, useRef, useState } from "react";

/**
 * Tracks the tallest height a region reaches while `active` and returns it as
 * a `minHeight`, so transient content (spinners, steps collapsing into a
 * drawer) can disappear without the region shrinking and shifting the scroll
 * position. Resets to 0 once `active` turns off.
 */
export function useRatchetedMinHeight(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState(0);

  useEffect(() => {
    if (!active) {
      setMinHeight(0);
      return;
    }
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    // Observing the same element the minHeight is applied to is safe: it can
    // only grow past the floor when content does, so the max is stable.
    const observer = new ResizeObserver(() => {
      const height = el.offsetHeight;
      setMinHeight((prev) => (height > prev ? height : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  return { ref, minHeight };
}
