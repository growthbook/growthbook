import { useEffect, useRef } from "react";
import EChartsReact from "echarts-for-react";
import { FactTableDefinition, RowFilter } from "shared/types/fact-table";
import { ExplorationConfig } from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import {
  ExplorerProvider,
  useExplorerContext,
} from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { cssColorToHex } from "@/enterprise/components/ProductAnalytics/chart-theme";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { getActivityChart } from "./activityChart";

function ActivityChart({ revision }: { revision: number }) {
  const { theme } = useAppearanceUITheme();
  const {
    exploration,
    loading,
    error,
    isSubmittable,
    managedWarehouseUnavailable,
    handleSubmit,
  } = useExplorerContext();
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    void handleSubmit({ force: true });
  }, [revision, handleSubmit]);
  if (managedWarehouseUnavailable)
    return (
      <Text color="text-mid">
        Activity will be available when the warehouse is ready.
      </Text>
    );
  if (loading)
    return <Text color="text-mid">Loading activity over the last 7 days…</Text>;
  if (error)
    return (
      <Callout
        status="error"
        action={
          <Button
            size="sm"
            variant="soft"
            onClick={() => handleSubmit({ force: true })}
          >
            Retry activity
          </Button>
        }
      >
        {error}
      </Callout>
    );
  if (!isSubmittable)
    return (
      <Text color="text-mid">
        Complete the required query settings to preview activity.
      </Text>
    );
  if (!exploration?.result) return null;
  const chart = getActivityChart(exploration);
  return (
    <div>
      <Text as="div" size="xl" weight="semibold">
        {chart.total.toLocaleString()}
      </Text>
      <Text as="div" size="sm" color="text-mid">
        Matching rows · last 7 days
      </Text>
      <EChartsReact
        key={theme}
        notMerge
        option={{
          aria: { enabled: true },
          grid: { top: 12, right: 0, bottom: 0, left: 0 },
          tooltip: { trigger: "axis", renderMode: "richText" },
          xAxis: { type: "category", data: chart.days, show: false },
          yAxis: { type: "value", show: false, minInterval: 1 },
          series: [
            {
              name: "Matching rows",
              type: "bar",
              barCategoryGap: "15%",
              data: chart.counts.map((value, index) => ({
                value,
                itemStyle: {
                  color:
                    index === chart.counts.length - 1
                      ? cssColorToHex("var(--violet-9)")
                      : cssColorToHex("var(--violet-4)"),
                  borderRadius: [2, 2, 0, 0],
                },
              })),
            },
          ],
        }}
        style={{ width: "100%", height: "auto", aspectRatio: "4 / 1" }}
      />
      <Text as="div" size="sm" color="text-mid" mt="2">
        Daily source activity (UTC), filtered by this definition. Today is
        partial.
      </Text>
    </div>
  );
}

export default function MetricActivityChart({
  factTable,
  rowFilters,
  revision,
}: {
  factTable: FactTableDefinition;
  rowFilters: RowFilter[];
  revision: number;
}) {
  const config: ExplorationConfig = {
    ...DEFAULT_EXPLORE_STATE,
    dateRange: {
      ...DEFAULT_EXPLORE_STATE.dateRange,
      predefined: "last7Days",
      lookbackValue: 7,
    },
    type: "fact_table",
    datasource: factTable.datasource,
    dimensions: [
      { dimensionType: "date", column: "date", dateGranularity: "day" },
    ],
    chartType: "bar",
    dataset: {
      type: "fact_table",
      factTableId: factTable.id,
      values: [
        {
          type: "fact_table",
          valueType: "count",
          valueColumn: null,
          unit: null,
          name: "Matching rows",
          rowFilters,
        },
      ],
    },
  };
  return (
    <ExplorerProvider initialConfig={config} trackingSource="metric-preview">
      <ActivityChart revision={revision} />
    </ExplorerProvider>
  );
}
