import { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import DataVizConfigPanel, { DataVizConfig } from "./DataVizConfigPanel";

// We need to use any here because the rows are not typed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rows = readonly any[];

export default function SqlExplorerDataVisualization({ rows }: { rows: Rows }) {
  const [config, setConfig] = useState<DataVizConfig>({
    type: "bar",
    xKey: "",
    yKey: "",
  });

  const isConfigValid = config.xKey && config.yKey;

  const seriesData = useMemo(() => {
    return rows.map((row) => [row[config.xKey], row[config.yKey]]);
  }, [rows, config.xKey, config.yKey]);

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
    series: [
      {
        data: seriesData,
        type: config.type,
        stack: "total",
        stackStrategy: "negative",
      },
    ],
  };

  return (
    <Flex direction="row" gap="4">
      <Flex>
        <DataVizConfigPanel
          rows={rows}
          config={config}
          onConfigChange={setConfig}
        />
      </Flex>
      <Flex flexGrow="1">
        {!rows.length && (
          <div>
            This query has no results. Update the query to create a chart.
          </div>
        )}

        {!isConfigValid && <div>Select X and Y axis to create a chart.</div>}

        {isConfigValid && (
          <EChartsReact
            option={option}
            style={{ width: "100%", height: "300px" }}
          />
        )}
      </Flex>
    </Flex>
  );
}
