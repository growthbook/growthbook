import EChartsReact from "echarts-for-react";
import { FactTableDefinition } from "shared/types/fact-table";
import { getFactTableTimestampColumn } from "shared/experiments";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import {
  CHART_COLORS,
  getChartThemeColors,
} from "@/enterprise/components/ProductAnalytics/chart-theme";
import Text from "@/ui/Text";
import { getSampleChart } from "./sampleChart";

export default function MetricSampleChart({
  rows,
  column,
  factTable,
}: {
  rows: Record<string, unknown>[];
  column: string;
  factTable: FactTableDefinition;
}) {
  const { theme } = useAppearanceUITheme();
  const colors = getChartThemeColors(theme);
  const chart = getSampleChart(
    rows,
    column,
    getFactTableTimestampColumn(factTable),
  );
  if (!chart)
    return (
      <Text size="sm" color="text-mid">
        No usable values in these sample rows to visualize.
      </Text>
    );
  const label = chart.numeric
    ? factTable.columns.find((c) => c.column === column)?.name || column
    : "Date (UTC)";
  return (
    <div>
      <Text weight="semibold" as="div">
        {chart.numeric ? "Sample value distribution" : "Sample rows over time"}
      </Text>
      <EChartsReact
        notMerge
        option={{
          color: CHART_COLORS,
          useUTC: true,
          aria: { enabled: true },
          grid: {
            top: 35,
            right: 12,
            bottom: 45,
            left: 35,
            containLabel: true,
          },
          tooltip: { trigger: "axis", renderMode: "richText" },
          xAxis: {
            type: chart.numeric ? "category" : "time",
            data: chart.numeric ? chart.labels : undefined,
            name: label,
            nameLocation: "middle",
            nameGap: 30,
            axisLabel: { color: colors.textColor, hideOverlap: true },
            nameTextStyle: { color: colors.textColor },
          },
          yAxis: {
            type: "value",
            name: "Sample rows",
            minInterval: 1,
            axisLabel: { color: colors.textColor },
            nameTextStyle: { color: colors.textColor },
            splitLine: { lineStyle: { color: colors.gridLineColor } },
          },
          series: [
            {
              type: chart.numeric ? "bar" : "line",
              data: chart.numeric
                ? chart.counts
                : chart.labels.map((day, index) => [
                    Date.parse(`${day}T00:00:00Z`),
                    chart.counts[index],
                  ]),
              symbolSize: 7,
            },
          ],
        }}
        style={{ width: "100%", height: "auto", aspectRatio: "16 / 9" }}
      />
      <Text size="sm" color="text-mid" as="div">
        Based on {chart.sampleSize} of {rows.length} fetched rows. Sample data
        only; not the metric’s full performance.
      </Text>
    </div>
  );
}
