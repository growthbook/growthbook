import { useCallback, useRef, useSyncExternalStore } from "react";

/** Keep in sync with --header-height in global.scss. */
const HEADER_HEIGHT_PX = 56;

/** A pinned tab row's height. Keep in sync with --tabs-bar-height in global.scss. */
const TABS_BAR_HEIGHT_PX = 45;

// A bar pinned under the app header (the getting-started bar) pushes down
// what sticks or fills the window below it. The tallest is
// --pinned-bar-height; with the header's height it makes --page-top-offset
// (global.scss). The demo data banner isn't one: it overlaps what pins there.
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

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Where sticky bars pin, for code that measures against it.
export function usePageTopOffset(): number {
  const pinnedBarHeight = useSyncExternalStore(
    subscribe,
    () => barHeight,
    () => 0,
  );
  return HEADER_HEIGHT_PX + pinnedBarHeight;
}

/**
 * 1px under the header and any bar under it, so pinned tabs cover its edge.
 * Keep in sync with --tabs-top in global.scss.
 */
export function useTabsTop(): number {
  return usePageTopOffset() - 1;
}

/**
 * Under pinned tabs, where what sticks beneath them pins. Keep in sync with
 * --tabs-bottom in global.scss.
 */
export function useTabsBottom(): number {
  return useTabsTop() + TABS_BAR_HEIGHT_PX;
}
