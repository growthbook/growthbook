export const CHART_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#06b6d4",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#6b7280",
];

// A pinned copy of the ECharts 6.1 default palette, which SQL Explorer charts
// have always used. Kept so saved SQL Explorer charts keep their colors, so it
// intentionally does not follow later ECharts upgrades. Switching SQL Explorer
// to CHART_COLORS would recolor every saved chart.
export const SQL_EXPLORER_COLORS = [
  "#5070dd",
  "#b6d634",
  "#505372",
  "#ff994d",
  "#0ca8df",
  "#ffd10a",
  "#fb628b",
  "#785db0",
  "#3fbe95",
];

// Semantic colors for experiment results, as Radix tokens so they follow the
// theme. ECharts draws on canvas, so resolve them with cssColorToHex first.
export const EXPERIMENT_RESULT_COLORS = {
  won: "var(--green-9)",
  lost: "var(--red-9)",
  inconclusive: "var(--gray-9)",
  dnf: "var(--orange-9)",
} as const;

export const COMPARISON_SERIES_COLORS = [
  "#d97706",
  "#a8a29e",
  "#fbbf24",
  "#9ca3af",
  "#78716c",
];

// Keyed by the resolved color, so a theme switch (which changes what a
// CSS variable resolves to) misses the cache and gets the new hex.
const hexCache = new Map<string, string>();

/**
 * Normalize any CSS color — including a `var(--…)` reference — to `#rrggbb`.
 *
 * ECharts renders to canvas, so it can't resolve CSS variables, and the Radix
 * scales resolve to `color(display-p3 …)` on wide-gamut displays, which
 * zrender fails to parse (blanking bars on hover/legend emphasis). Painting
 * onto a 1×1 sRGB canvas and reading the pixel back converts anything the
 * browser understands into the hex form zrender handles.
 */
export function cssColorToHex(color: string): string {
  if (typeof document === "undefined") return color;
  const cssVar = color.match(/^var\((--[\w-]+)\)$/)?.[1];
  // Read from the Radix root: it remaps scales like --gray-* (to mauve), and
  // <html> doesn't see that.
  const resolved = cssVar
    ? getComputedStyle(
        document.querySelector(".radix-themes") ?? document.documentElement,
      )
        .getPropertyValue(cssVar)
        .trim()
    : color;
  const cached = hexCache.get(resolved);
  if (cached !== undefined) return cached;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!resolved || !ctx) return color;
  ctx.fillStyle = resolved;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  hexCache.set(resolved, hex);
  return hex;
}

export function getChartThemeColors(theme: "light" | "dark") {
  return {
    textColor: theme === "dark" ? "#FFFFFF" : "#1F2D5C",
    tooltipBackgroundColor: theme === "dark" ? "#1c2339" : "#FFFFFF",
    gridLineColor:
      theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
  };
}
