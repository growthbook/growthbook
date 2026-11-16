import { useEffect, useRef, useState } from "react";

/** Floor height while `active`, so transient content can't shrink the region and jump the scroll. */
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

    // Safe to observe this element: minHeight only grows when the content does.
    const observer = new ResizeObserver(() => {
      const height = el.offsetHeight;
      setMinHeight((prev) => (height > prev ? height : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  return { ref, minHeight };
}
