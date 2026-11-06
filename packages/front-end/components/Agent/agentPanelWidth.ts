/**
 * The docked AI Assistant panel's width: yours to drag, within limits that
 * keep it and the page usable. Past the widest, dragging on switches to its
 * expanded (focus) mode instead.
 */

/** Where it starts. */
export const PANEL_DEFAULT_WIDTH = 400;
/**
 * Its narrowest: tables in answers scroll sideways rather than squeeze
 * (AgentPanel.module.scss), and the header's title truncates to fit.
 */
export const PANEL_MIN_WIDTH = 300;
/**
 * About the expanded mode's 800px column and its padding; wider reads better
 * expanded.
 */
export const PANEL_MAX_WIDTH = 900;
/**
 * What the page keeps beside it, side nav aside: the narrowest our main pages
 * take without breaking (reflowing is fine). Metrics' filter row is cut off
 * below it, and the experiment page's linked changes overlap a little under
 * that. A page with its own right rail (the experiment page's details) keeps
 * the same room: when docking the rail would leave less, the rail floats over
 * the content instead (CollapsiblePanelLayout).
 */
export const PAGE_MIN_WIDTH = 540;
/**
 * Expanding by dragging is deliberate: this far past the widest, and held
 * there this long, before releasing expands it. A quick, hard drag just
 * leaves it at its widest.
 */
export const SNAP_PAST_PX = 120;
export const SNAP_HOLD_MS = 500;
export const KEY_STEP_PX = 16;
export const KEY_STEP_LARGE_PX = 64;

/**
 * The widest it can be now. Never under the minimum: on a small window it
 * stays at its default and can't be resized (the handle hides).
 */
export function maxPanelWidth(windowWidth: number, navWidth: number): number {
  return Math.max(
    PANEL_MIN_WIDTH,
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
  return `clamp(${PANEL_MIN_WIDTH}px, ${Math.round(width)}px, max(${PANEL_MIN_WIDTH}px, min(${PANEL_MAX_WIDTH}px, 100vw - var(--page-nav-width, 0px) - ${PAGE_MIN_WIDTH}px)))`;
}

/**
 * Room to widen it by at least a key step; otherwise the handle hides rather
 * than barely moving.
 */
export function canResizePanel(max: number): boolean {
  return max - PANEL_MIN_WIDTH >= KEY_STEP_PX;
}

/**
 * Dragging its inner (left) edge: moving left widens it. pastSnap is far
 * enough past the widest to start the hold that arms expanding.
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
}): { width: number; pastSnap: boolean } {
  const raw = startWidth + (startX - x);
  return {
    width: clampPanelWidth(raw, max),
    pastSnap: raw >= max + SNAP_PAST_PX,
  };
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
