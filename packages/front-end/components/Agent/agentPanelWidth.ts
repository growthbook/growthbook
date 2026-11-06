/**
 * The docked AI Assistant panel's width: yours to drag, within limits that
 * keep both it and the page usable. Past the widest, dragging on switches to
 * its expanded (focus) mode instead.
 */

/** Today's width, and where it starts. */
export const PANEL_DEFAULT_WIDTH = 400;
/** Its header, cards and message box still fit. */
export const PANEL_MIN_WIDTH = 360;
/** Wider reads better as the expanded mode's centered column. */
export const PANEL_MAX_WIDTH = 720;
/**
 * What the page keeps beside it, side nav aside: room for a page with a right
 * rail, such as the experiment page's 360px one beside its content.
 */
export const PAGE_MIN_WIDTH = 800;
/** How far past the widest a drag goes before releasing expands it. */
export const SNAP_PAST_PX = 80;
export const KEY_STEP_PX = 16;
export const KEY_STEP_LARGE_PX = 64;

/**
 * The widest it can be now. Never under the default, so on a small window it
 * stays as wide as it always was and just doesn't go wider.
 */
export function maxPanelWidth(windowWidth: number, navWidth: number): number {
  return Math.max(
    PANEL_DEFAULT_WIDTH,
    Math.min(PANEL_MAX_WIDTH, windowWidth - navWidth - PAGE_MIN_WIDTH),
  );
}

export function clampPanelWidth(width: number, max: number): number {
  return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, width)));
}

/**
 * The same limits in CSS, so the page and the panel follow a window resize or
 * the side nav without JavaScript. --page-nav-width is the side nav's room.
 */
export function panelWidthCss(width: number): string {
  return `clamp(${PANEL_MIN_WIDTH}px, ${Math.round(width)}px, max(${PANEL_DEFAULT_WIDTH}px, min(${PANEL_MAX_WIDTH}px, 100vw - var(--page-nav-width, 0px) - ${PAGE_MIN_WIDTH}px)))`;
}

/**
 * Dragging its inner (left) edge: moving left widens it. Far enough past the
 * widest, releasing expands it.
 */
export function dragPanelWidth({
  startWidth,
  startX,
  x,
  max,
}: {
  startWidth: number;
  startX: number;
  x: number;
  max: number;
}): { width: number; snap: boolean } {
  const raw = startWidth + (startX - x);
  return { width: clampPanelWidth(raw, max), snap: raw >= max + SNAP_PAST_PX };
}

/**
 * The handle's keys, as a vertical separator on the panel's left edge: Left
 * widens, Right narrows, Shift for bigger steps, Home and End for the limits.
 * null for other keys.
 */
export function keyPanelWidth(
  width: number,
  key: string,
  shiftKey: boolean,
  max: number,
): number | null {
  const step = shiftKey ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
  switch (key) {
    case "ArrowLeft":
      return clampPanelWidth(width + step, max);
    case "ArrowRight":
      return clampPanelWidth(width - step, max);
    case "Home":
      return PANEL_MIN_WIDTH;
    case "End":
      return max;
    default:
      return null;
  }
}

/** A saved width, or null if it's missing or not one it could have saved. */
export function parseSavedPanelWidth(value: string | null): number | null {
  if (value === null) return null;
  const width = Number(value);
  if (!Number.isFinite(width)) return null;
  if (width < PANEL_MIN_WIDTH || width > PANEL_MAX_WIDTH) return null;
  return Math.round(width);
}
