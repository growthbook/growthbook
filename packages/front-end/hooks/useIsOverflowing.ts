import { RefObject, useEffect, useState } from "react";

/**
 * Whether an element's content runs taller than `maxHeight`, rechecked as the
 * content resizes. For clamping a block and offering the rest only when there
 * is a rest.
 */
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
