import { useEffect, useState } from "react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

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

// The ECharts 6 default palette, which SQL Explorer charts have always used.
// Named here so it lives with the other chart colors; switching SQL Explorer
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

function resolveChartColors<T extends Record<string, string>>(
  tokens: T,
): Record<keyof T, string> {
  return Object.fromEntries(
    Object.entries(tokens).map(([key, color]) => [key, cssColorToHex(color)]),
  ) as Record<keyof T, string>;
}

/**
 * Resolve a map of CSS colors (usually Radix tokens) to hex for ECharts, and
 * re-resolve when the theme changes. Pass a module-level constant: a new
 * object on every render would re-run the effect on every render.
 *
 * This resolves in an effect, not during render, because the theme provider
 * swaps the <html> theme class in a layout effect that runs after its
 * children render. A render-time read gets the previous theme's colors.
 */
export function useResolvedChartColors<T extends Record<string, string>>(
  tokens: T,
): Record<keyof T, string> {
  const { theme } = useAppearanceUITheme();
  const [colors, setColors] = useState(() => resolveChartColors(tokens));
  useEffect(() => setColors(resolveChartColors(tokens)), [theme, tokens]);
  return colors;
}

export function getChartThemeColors(theme: "light" | "dark") {
  return {
    textColor: theme === "dark" ? "#FFFFFF" : "#1F2D5C",
    tooltipBackgroundColor: theme === "dark" ? "#1c2339" : "#FFFFFF",
    gridLineColor:
      theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
  };
}
