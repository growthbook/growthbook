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

export function getChartThemeColors(theme: "light" | "dark") {
  return {
    textColor: theme === "dark" ? "#FFFFFF" : "#1F2D5C",
    tooltipBackgroundColor: theme === "dark" ? "#1c2339" : "#FFFFFF",
    gridLineColor:
      theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
  };
}
