import { useMemo } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import * as echarts from "echarts";
import { aggregate } from "echarts-simple-transform";
import {
  DataVizConfig,
  dataVizConfigValidator,
} from "back-end/src/validators/saved-queries";
import { Panel, PanelGroup, PanelResizeHandle } from "../ResizablePanels";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";
import DataVizConfigPanel from "./DataVizConfigPanel";

// We need to use any here because the rows are defined only in runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rows = any[];

export default function SqlExplorerDataVisualization({
  rows,
  dataVizConfig,
  onDataVizConfigChange,
}: {
  rows: Rows;
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
}) {
  echarts.registerTransform(aggregate);

  const isConfigValid = useMemo(() => {
    const parsed = dataVizConfigValidator.strip().safeParse(dataVizConfig);
    console.log(parsed);
    return parsed.success;
  }, [dataVizConfig]);

  const parsedRows = useMemo(() => {
    const xType = dataVizConfig.xAxis?.type;
    // const yType = "number";

    const xField = dataVizConfig.xAxis?.fieldName;
    const yField = dataVizConfig.yAxis?.[0]?.fieldName;

    if (!xField || !yField) {
      return rows;
    }

    return rows.map((row) => {
      const newRow = { ...row };

      // Cast xField value based on xType
      if (xField in newRow) {
        const xValue = newRow[xField];
        if (xType === "number" && xValue !== null && xValue !== undefined) {
          newRow[xField] =
            typeof xValue === "string"
              ? parseFloat(xValue) || 0
              : Number(xValue);
        } else if (
          xType === "date" &&
          xValue !== null &&
          xValue !== undefined
        ) {
          newRow[xField] = new Date(xValue);
        }
        // For category/string type, keep as is
      }

      // // Cast yField value based on yType
      // if (yField in newRow) {
      //   const yValue = newRow[yField];
      //   if (yType === "number" && yValue !== null && yValue !== undefined) {
      //     newRow[yField] =
      //       typeof yValue === "string"
      //         ? parseFloat(yValue) || 0
      //         : Number(yValue);
      //   } else if (
      //     yType === "date" &&
      //     yValue !== null &&
      //     yValue !== undefined
      //   ) {
      //     newRow[yField] = new Date(yValue);
      //   }
      // For category/string type, keep as is
      // }

      return newRow;
    });
  }, [
    dataVizConfig.xAxis?.fieldName,
    dataVizConfig.xAxis?.type,
    dataVizConfig.yAxis,
    rows,
  ]);

  const dataset = useMemo(() => {
    // TODO: Get type from echarts if possible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transform: any[] = [];

    if (dataVizConfig.xAxis?.sort) {
      transform.push({
        print: true,
        type: "sort",
        config: {
          dimension: dataVizConfig.xAxis!.fieldName,
          order: dataVizConfig.xAxis!.sort,
        },
      });
    }

    // if (dataVizConfig.yAxis?.[0]?.sort) {
    //   transform.push({
    //     type: "sort",
    //     config: {
    //       dimension: dataVizConfig.yAxis![0]!.fieldName,
    //       order: dataVizConfig.yAxis![0]!.sort,
    //     },
    //   });
    // }

    const yAxisConfig = dataVizConfig.yAxis?.[0];
    if (yAxisConfig && yAxisConfig.aggregation !== "none") {
      transform.push({
        type: "ecSimpleTransform:aggregate",
        config: {
          resultDimensions: [
            // by default, use the same name with `from`.
            { from: yAxisConfig.fieldName, method: yAxisConfig.aggregation },
            { from: dataVizConfig.xAxis!.fieldName },
          ],
          groupBy: dataVizConfig.xAxis!.fieldName,
        },
        print: true,
      });
    }

    console.log(transform);

    // const dimensionConfig = dataVizConfig.dimension?.[0];
    // if (dimensionConfig) {
    //   transform.push({
    //     type: "ecSimpleTransform:aggregate",
    //     config: {
    //       resultDimensions: [
    //         // by default, use the same name with `from`.
    //         { from: "Global_Sales", method: "sum" },
    //         { from: "Year" },
    //       ],
    //       groupBy: "Year",
    //     },
    //     print: true,
    //   });
    // }

    return [
      {
        source: parsedRows,
      },
      ...(transform.length > 0
        ? [
            {
              transform,
            },
          ]
        : []),
    ];
  }, [parsedRows, dataVizConfig.xAxis, dataVizConfig.yAxis]);

  const series = useMemo(() => {
    return [
      {
        type:
          dataVizConfig.chartType === "area" ? "line" : dataVizConfig.chartType,
        areaStyle: {},
        encode: {
          x: dataVizConfig.xAxis!.fieldName,
          y: dataVizConfig.yAxis![0].fieldName,
        },
        datasetIndex: 1,
      },
    ];

    // TODO(adriel): Implement dimension
    // const dimensionSeries = new Set(
    //   parsedRows.map((row) => row[dimensionConfig.fieldName])
    // )
    //   .values()
    //   .map((value) => {
    //     return {
    //       name: value,
    //       type: config.chartType === "area" ? "line" : "bar",
    //       encode: { x: config.xAxis!.fieldName, y: config.yAxis![0].fieldName },
    //     };
    //   });

    // return dimensionSeries;
  }, [dataVizConfig.chartType, dataVizConfig.xAxis, dataVizConfig.yAxis]);

  const option = useMemo(() => {
    return {
      dataset,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
      },
      xAxis: {
        name: dataVizConfig.xAxis?.fieldName,
        nameLocation: "middle",
        nameTextStyle: {
          fontSize: 14,
          fontWeight: "bold",
          padding: [20, 0],
        },
        type:
          dataVizConfig.xAxis?.type === "date"
            ? "time"
            : dataVizConfig.xAxis?.type === "number"
            ? "value"
            : "category",
        // axisLabel: { interval: 0, rotate: 30 },
      },
      yAxis: {
        name: dataVizConfig.yAxis?.[0]?.fieldName,
        nameLocation: "middle",
        nameTextStyle: {
          fontSize: 14,
          fontWeight: "bold",
          padding: [20, 0],
        },
      },
      series,
    };
  }, [dataset, series, dataVizConfig]);

  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={75}>
        <AreaWithHeader
          header={
            <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
              Graph
            </Text>
          }
        >
          {isConfigValid ? (
            <Flex justify="center" align="center" height="100%">
              <EChartsReact
                option={option}
                style={{ width: "100%", height: "80%" }}
                echarts={echarts}
              />
            </Flex>
          ) : (
            <Flex justify="center" align="center" height="100%">
              Select X and Y axis on the side panel to visualize your data.
            </Flex>
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
          <Box p="4" style={{ overflow: "scroll", height: "100%" }}>
            <DataVizConfigPanel
              sampleRow={rows[0]}
              dataVizConfig={dataVizConfig}
              onDataVizConfigChange={onDataVizConfigChange}
            />
          </Box>
        </AreaWithHeader>
      </Panel>
    </PanelGroup>
  );
}
