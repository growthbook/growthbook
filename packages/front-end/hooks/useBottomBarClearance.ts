import { RefCallback, useCallback, useRef } from "react";

// Help launchers rise above the tallest mounted bottom bar via --bottom-bar-clearance.
const barHeights = new Map<Element, number>();

function publish() {
  const clearance = Math.max(0, ...barHeights.values());
  document.documentElement.style.setProperty(
    "--bottom-bar-clearance",
    `${clearance}px`,
  );
}

export default function useBottomBarClearance<
  T extends HTMLElement,
>(): RefCallback<T> {
  const attached = useRef<{ el: T; observer: ResizeObserver } | null>(null);

  return useCallback((el: T | null) => {
    if (attached.current) {
      attached.current.observer.disconnect();
      barHeights.delete(attached.current.el);
      attached.current = null;
      publish();
    }
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      barHeights.set(
        el,
        entry.borderBoxSize?.[0]?.blockSize ??
          el.getBoundingClientRect().height,
      );
      publish();
    });
    barHeights.set(el, el.getBoundingClientRect().height);
    publish();
    observer.observe(el, { box: "border-box" });
    attached.current = { el, observer };
  }, []);
}
