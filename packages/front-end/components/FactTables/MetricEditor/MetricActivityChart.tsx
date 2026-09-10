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
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { getActivityChart } from "./activityChart";

function ActivityChart({ revision }: { revision: number }) {
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
    return (
      <Text color="text-mid">Loading activity over the last 30 days…</Text>
    );
  if (error)
    return (
      <Callout status="error">
        {error}
        <Button
          size="sm"
          variant="soft"
          onClick={() => handleSubmit({ force: true })}
        >
          Retry activity
        </Button>
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
      <Heading as="h3" size="2xl" mb="0">
        {chart.total.toLocaleString()}
      </Heading>
      <Text as="div" size="sm" color="text-mid">
        Matching rows · last 30 days
      </Text>
      <EChartsReact
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
                    index === chart.counts.length - 1 ? "#7759df" : "#ddd3fa",
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
