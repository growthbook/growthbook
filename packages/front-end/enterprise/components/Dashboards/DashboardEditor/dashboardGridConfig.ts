import { DASHBOARD_GRID_COLS } from "shared/enterprise";

// Keep the same column count at every breakpoint so saved block coordinates
// represent one shared layout instead of diverging between viewport sizes.
export const RGL_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 0 } as const;
export const RGL_COLS = {
  lg: DASHBOARD_GRID_COLS,
  md: DASHBOARD_GRID_COLS,
  sm: DASHBOARD_GRID_COLS,
  xs: DASHBOARD_GRID_COLS,
} as const;
export const RGL_CANONICAL_BREAKPOINT: keyof typeof RGL_BREAKPOINTS = "lg";

export const CANONICAL_COL_BREAKPOINTS: ReadonlyArray<
  keyof typeof RGL_BREAKPOINTS
> = (Object.keys(RGL_COLS) as Array<keyof typeof RGL_COLS>).filter(
  (bp) => RGL_COLS[bp] === RGL_COLS[RGL_CANONICAL_BREAKPOINT],
);
