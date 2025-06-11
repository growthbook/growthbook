import { useMemo, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { DataVizConfig } from "back-end/src/validators/saved-queries";
import { Panel, PanelGroup, PanelResizeHandle } from "../ResizablePanels";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";
import DataVizConfigPanel from "./DataVizConfigPanel";

// We need to use any here because the rows are not typed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rows = any[];

export default function SqlExplorerDataVisualization({ rows }: { rows: Rows }) {
  const [config, setConfig] = useState<DataVizConfig>({
    chartType: "line",
    xAxis: "",
    yAxis: "",
  });

  const isConfigValid = config.xAxis && config.yAxis;

  const series = useMemo(() => {
    if (!config.xAxis || !config.yAxis) return [];

    let groupedRows: { name: string; rows: Rows }[] = rows;
    if (config.aggregation === "stacked" && config.aggregationAxis) {
      const groupedData = new Map<string, Rows>();

      rows.forEach((row) => {
        const groupKey = String(row[config.aggregationAxis!]);
        if (!groupedData.has(groupKey)) {
          groupedData.set(groupKey, []);
        }
        groupedData.get(groupKey)!.push(row);
      });

      groupedRows = Array.from(groupedData.entries()).map(([name, rows]) => ({
        name,
        rows,
      }));
    } else {
      groupedRows = [{ name: "Total", rows }];
    }

    // Handle regular aggregation (grouped by x-axis)
    if (config.aggregation === "grouped") {
      const perGroupAggregated = new Map<string, Map<unknown, number>>();
      const aggregated = new Map<unknown, number>();
      groupedRows.forEach(({ name, rows }) => {
        rows.map((row) => {
          const x = row[config.xAxis!];
          const y = row[config.yAxis!];
          const currentSum = aggregated.get(x) || 0;
          aggregated.set(x, currentSum + (Number(y) || 0));
        });
        perGroupAggregated.set(name, aggregated);
      });

      // groupedRows = Array.from(perGroupAggregated.entries()).map(
      //   ([name, aggregated]) => ({
      //     name,
      //     rows: aggregated,
      //   })
      // );
    }

    // Return single series for non-aggregationAxis case
    return groupedRows.map(({ name, rows }) => ({
      name,
      data: rows
        .map((row) => [row[config.xAxis!], row[config.yAxis!]])
        .sort((a, b) => {
          if (a[0] < b[0]) return -1;
          if (a[0] > b[0]) return 1;
          return 0;
        }),
      type: config.chartType === "area" ? "line" : config.chartType,
      areaStyle: config.chartType === "area" ? {} : undefined,
    }));
  }, [
    rows,
    config.chartType,
    config.xAxis,
    config.yAxis,
    config.aggregation,
    config.aggregationAxis,
  ]);

  const option = {
    // TODO: Define the types based on the data
    tooltip: {
      trigger: "axis",
      axisPointer: {
        label: {
          backgroundColor: "#6a7985",
        },
      },
    },
    xAxis: {
      type: "time",
      // TODO: Generate domain?
      // data: resultToRender.map((row) => row[config.xKey]),
    },
    yAxis: {
      type: "value",
    },
    series,
  };

  return (
    <PanelGroup direction="horizontal">
      <Panel>
        <AreaWithHeader
          header={
            <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
              Graph
            </Text>
          }
        >
          {!rows.length && (
            <Flex justify="center" align="center" height="100%">
              This query has no results. Update the query to create a chart.
            </Flex>
          )}

          {!isConfigValid && (
            <Flex justify="center" align="center" height="100%">
              Select X and Y axis on the side panel to visualize your data.
            </Flex>
          )}

          {isConfigValid && (
            <EChartsReact
              option={option}
              style={{ width: "100%", height: "300px" }}
            />
          )}
        </AreaWithHeader>
      </Panel>
      <PanelResizeHandle />
      <Panel defaultSize={25}>
        <AreaWithHeader
          header={
            <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
              Configuration
            </Text>
          }
        >
          <Box p="4">
            <DataVizConfigPanel
              rows={rows}
              config={config}
              onConfigChange={setConfig}
            />
          </Box>
        </AreaWithHeader>
      </Panel>
    </PanelGroup>
  );
}
