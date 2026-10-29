import { useCallback, useRef, useSyncExternalStore } from "react";
import { useHeaderHeight } from "./headerHeight";

// Bars pinned under the app header (the getting-started bar, the demo data
// banner) push down what sticks or fills the window below them. Their
// tallest is --pinned-bar-height; with the header's height, whatever that is
// at the window's width, it makes --page-top-offset (global.scss).
const barHeights = new Map<Element, number>();
const listeners = new Set<() => void>();
let barHeight = 0;
let resizeObserver: ResizeObserver | null = null;

function update() {
  const next = Math.max(0, ...barHeights.values());
  if (next === barHeight) return;
  barHeight = next;
  const root = document.documentElement.style;
  if (next === 0) {
    root.removeProperty("--pinned-bar-height");
  } else {
    root.setProperty("--pinned-bar-height", `${next}px`);
  }
  listeners.forEach((listener) => listener());
}

function register(el: HTMLElement) {
  resizeObserver ??= new ResizeObserver((entries) => {
    entries.forEach(({ target }) => {
      if (barHeights.has(target)) {
        barHeights.set(
          target,
          Math.ceil(target.getBoundingClientRect().height),
        );
      }
    });
    update();
  });
  barHeights.set(el, Math.ceil(el.getBoundingClientRect().height));
  resizeObserver.observe(el);
  update();
}

function unregister(el: HTMLElement) {
  resizeObserver?.unobserve(el);
  barHeights.delete(el);
  update();
}

// A callback ref, so a bar that renders conditionally is counted while it
// shows.
export function usePinnedBar<T extends HTMLElement>() {
  const current = useRef<T | null>(null);
  return useCallback((el: T | null) => {
    if (current.current) unregister(current.current);
    current.current = el;
    if (el) register(el);
  }, []);
}

// Where sticky bars pin, for code that measures against it.
export function usePageTopOffset(): number {
  const pinnedBarHeight = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => barHeight,
    () => 0,
  );
  return useHeaderHeight() + pinnedBarHeight;
}

/**
 * 1px under the header and any bar under it, so pinned tabs cover its edge.
 * Keep in sync with --tabs-top in global.scss.
 */
export function useTabsTop(): number {
  return usePageTopOffset() - 1;
}

/** Keep in sync with --tabs-bar-height in global.scss. */
const TABS_BAR_HEIGHT_PX = 40;

/** Keep in sync with --tabs-bottom in global.scss. */
export function useTabsBottom(): number {
  return useTabsTop() + TABS_BAR_HEIGHT_PX;
}
