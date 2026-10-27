import EChartsReact from "echarts-for-react";
import { date } from "shared/dates";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { formatUtcWeekday } from "@/components/QueryPreview/activityChart";
import {
  cssColorToHex,
  getChartThemeColors,
} from "@/enterprise/components/ProductAnalytics/chart-theme";

// One bar per UTC day, shared by the metric and population previews.
export default function DailyBarChart({
  days,
  values,
  seriesName,
  integerYAxis = false,
  tooltipLines,
  height,
}: {
  days: string[];
  values: number[];
  seriesName: string;
  /** Show a y-axis with whole-number ticks; hidden by default. */
  integerYAxis?: boolean;
  /** Lines under the tooltip's date header. Defaults to the day's value. */
  tooltipLines?: (day: string, value: number) => string[];
  /** Fixed pixel height; defaults to a 2:1 aspect ratio. */
  height?: number;
}) {
  const { theme } = useAppearanceUITheme();
  const { textColor, tooltipBackgroundColor } = getChartThemeColors(theme);
  const valueByDay = new Map(days.map((day, i) => [day, values[i] ?? 0]));
  const axisLabelColor = cssColorToHex("var(--gray-10)");

  return (
    <EChartsReact
      key={theme}
      notMerge
      option={{
        grid: {
          top: 20,
          right: integerYAxis ? 8 : 0,
          bottom: 28,
          left: integerYAxis ? 50 : 0,
        },
        tooltip: {
          appendTo: "body",
          trigger: "axis",
          padding: [10, 14],
          backgroundColor: tooltipBackgroundColor,
          textStyle: { color: textColor },
          axisPointer: { type: "shadow" },
          formatter: (params: unknown) => {
            const point = (Array.isArray(params) ? params[0] : params) as {
              name?: string;
            };
            const day = String(point?.name ?? "");
            const value = valueByDay.get(day) ?? 0;
            const lines = tooltipLines?.(day, value) ?? [
              `${seriesName}: ${value.toLocaleString()}`,
            ];
            return [
              `<strong>${date(new Date(`${day.slice(0, 10)}T00:00:00Z`), "UTC")}</strong>`,
              ...lines,
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "category",
          data: days,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: axisLabelColor,
            formatter: (day: string) => formatUtcWeekday(day, "short"),
          },
        },
        yAxis: integerYAxis
          ? {
              type: "value",
              minInterval: 1,
              axisLabel: { color: axisLabelColor },
              splitLine: {
                lineStyle: { color: cssColorToHex("var(--gray-5)") },
              },
            }
          : { type: "value", show: false },
        series: [
          {
            name: seriesName,
            type: "bar",
            barCategoryGap: "15%",
            data: values,
            itemStyle: {
              color: cssColorToHex("var(--violet-9)"),
              borderRadius: [2, 2, 0, 0],
            },
          },
        ],
      }}
      style={
        height !== undefined
          ? { width: "100%", height }
          : { width: "100%", height: "auto", aspectRatio: "2 / 1" }
      }
    />
  );
}
