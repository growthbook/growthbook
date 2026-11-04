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

export const COMPARISON_SERIES_COLORS = [
  "#d97706",
  "#a8a29e",
  "#fbbf24",
  "#9ca3af",
  "#78716c",
];

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
  const resolved = cssVar
    ? getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
    : color;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!resolved || !ctx) return color;
  ctx.fillStyle = resolved;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function getChartThemeColors(theme: "light" | "dark") {
  return {
    textColor: theme === "dark" ? "#FFFFFF" : "#1F2D5C",
    tooltipBackgroundColor: theme === "dark" ? "#1c2339" : "#FFFFFF",
    gridLineColor:
      theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
  };
}
