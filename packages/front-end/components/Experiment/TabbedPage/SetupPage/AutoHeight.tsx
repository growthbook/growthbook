import { ReactNode, useLayoutEffect, useRef } from "react";
import styles from "./AutoHeight.module.scss";

// A box whose height eases to its contents' whenever they change (set in
// review): Timing's and Decision's grey boxes, as controls and rows appear
// and disappear, and Timing as Edit opens it. Measured with a
// ResizeObserver and set directly on the element, before paint, so nothing
// overflows for a frame. Clipped only while it animates, so focus rings and
// menus aren't cut off otherwise. See AutoHeight.module.scss.
export default function AutoHeight({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    let last = inner.offsetHeight;
    outer.style.height = `${last}px`;
    const observer = new ResizeObserver(() => {
      const next = inner.offsetHeight;
      if (next === last) return;
      last = next;
      outer.dataset.animating = "true";
      outer.style.height = `${next}px`;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      className={styles.autoHeight}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "height") {
          delete e.currentTarget.dataset.animating;
        }
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
