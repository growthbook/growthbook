import { RefObject, useEffect, useState } from "react";

/** Whether an element's content runs taller than `maxHeight`, as it resizes. */
export default function useIsOverflowing(
  ref: RefObject<HTMLElement>,
  maxHeight: number,
): boolean {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > maxHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, maxHeight]);
  return overflows;
}

/**
 * Whether an element's content runs wider than the element. The table inside
 * is watched too: its columns can outgrow a wrapper whose width holds still.
 * `content` re-checks text that changes inside a box whose size doesn't.
 */
export function useIsOverflowingX(
  ref: RefObject<HTMLElement>,
  enabled = true,
  content?: unknown,
): boolean {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    // The element can be replaced, e.g. wrapped by a tooltip once it
    // overflows, so each check measures and watches whichever is current.
    let watched: HTMLElement | null = null;
    const observer = new ResizeObserver(() => check());
    const check = () => {
      const el = ref.current;
      if (!el) return;
      if (el !== watched) {
        observer.disconnect();
        observer.observe(el);
        const table = el.querySelector("table");
        if (table) observer.observe(table);
        watched = el;
      }
      setOverflows(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    return () => observer.disconnect();
  }, [ref, enabled, content]);
  return overflows;
}
