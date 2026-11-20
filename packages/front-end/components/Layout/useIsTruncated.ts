import { useEffect, useState } from "react";

/**
 * Whether the element's text is cut off by its ellipsis. Takes the element
 * rather than a ref, so it re-measures when the element comes back (e.g. a
 * label on expanding the sidebar).
 */
export function useIsTruncated(el: HTMLElement | null, text: string): boolean {
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (!el) {
      setTruncated(false);
      return;
    }
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, text]);
  return truncated;
}
