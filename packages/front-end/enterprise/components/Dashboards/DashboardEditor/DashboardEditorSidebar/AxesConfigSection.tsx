import { useCallback, useMemo } from "react";
import Collapsible from "react-collapsible";
import { Box, Flex, Separator, Text } from "@radix-ui/themes";
import { FaAngleRight } from "react-icons/fa";
import {
  DashboardBlockInterfaceOrData,
  DataVisualizationBlockInterface,
} from "shared/enterprise";
import {
  DataVizConfig,
  xAxisDateAggregationUnit,
  yAxisAggregationType,
  BigValueFormat,
  xAxisConfiguration,
} from "shared/validators";
import { Select, SelectItem } from "@/ui/Select";
import {
  getXAxisConfig,
  setXAxisConfig,
  updateXAxisConfig,
} from "@/services/dataVizConfigUtilities";
import { inferFieldType } from "@/components/DataViz/DataVizConfigPanel";

interface Props {
  block: DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>
  >;
  rows: Record<string, unknown>[];
  axisKeys: string[];
}

export default function AxesConfigSection({
  block,
  setBlock,
  rows,
  axisKeys,
}: Props) {
  const dataVizConfig = block.dataVizConfig?.[0];

  const getInferredFieldType = useCallback(
    (fieldName: string): xAxisConfiguration["type"] => {
      if (!rows[0]) return "string";
      return inferFieldType(rows[0], fieldName);
    },
    [rows],
  );

  const xAxisConfigs = useMemo(
    () => (dataVizConfig ? getXAxisConfig(dataVizConfig) : []),
    [dataVizConfig],
  );
  const xConfig = xAxisConfigs[0];

  const onDataVizConfigChange = useCallback(
    (newConfig: Partial<DataVizConfig>) => {
      setBlock({
        ...block,
        dataVizConfig: [newConfig as DataVizConfig],
      });
    },
    [block, setBlock],
  );

  if (!dataVizConfig || !rows.length) {
    return null;
  }

  if (dataVizConfig.chartType === "pivot-table") {
    return null;
  }

  return (
    <Flex
      direction="column"
      height="100%"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        overflow: "hidden",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Collapsible
        open={true}
        transitionTime={100}
        trigger={
          <div
            style={{
              paddingLeft: "12px",
              paddingRight: "12px",
              paddingTop: "12px",
              paddingBottom: "12px",
              borderBottom: "1px solid var(--gray-a3)",
            }}
          >
            <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
              <Flex justify="between" align="center">
                <Flex align="center" gap="1">
                  Axes
                </Flex>
                <FaAngleRight className="chevron" />
              </Flex>
            </Text>
          </div>
        }
      >
        <Box p="4" height="fit-content">
          <Flex direction="column" gap="3">
            {dataVizConfig.chartType === "big-value" ? (
              <>
                <Select
                  label="Value Column"
                  value={dataVizConfig.yAxis?.[0]?.fieldName ?? ""}
                  setValue={(v) => {
                    if (!v) return;
                    const type = getInferredFieldType(v);
                    onDataVizConfigChange({
                      ...dataVizConfig,
                      yAxis: [
                        {
                          fieldName: v,
                          type,
                          aggregation: "sum",
                        },
                      ],
                    });
                  }}
                  size="2"
                  placeholder="Select Value Column"
                >
                  {axisKeys
                    .filter((key) => getInferredFieldType(key) === "number")
                    .map((key) => (
                      <SelectItem key={key} value={key}>
                        {key}
                      </SelectItem>
                    ))}
                </Select>
                <Select
                  label="Format"
                  size="2"
                  value={dataVizConfig.format ?? "shortNumber"}
                  setValue={(v) => {
                    onDataVizConfigChange({
                      ...dataVizConfig,
                      format: v as BigValueFormat,
                    });
                  }}
                >
                  <SelectItem value="shortNumber">Short Number</SelectItem>
                  <SelectItem value="longNumber">Long Number</SelectItem>
                  <SelectItem value="currency">Currency</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="accounting">Accounting</SelectItem>
                </Select>
                <Select
                  label="Aggregation"
                  size="2"
                  value={dataVizConfig.yAxis?.[0]?.aggregation ?? "sum"}
                  setValue={(v) => {
                    onDataVizConfigChange({
                      ...dataVizConfig,
                      yAxis: [
                        {
                          fieldName: dataVizConfig.yAxis?.[0]?.fieldName ?? "",
                          type: dataVizConfig.yAxis?.[0]?.type ?? "number",
                          aggregation: v as yAxisAggregationType,
                        },
                      ],
                    });
                  }}
                >
                  <SelectItem value="sum">Sum</SelectItem>
                  <SelectItem value="average">Average</SelectItem>
                  <SelectItem value="min">Min</SelectItem>
                  <SelectItem value="max">Max</SelectItem>
                  <SelectItem value="first">First</SelectItem>
                  <SelectItem value="last">Last</SelectItem>
                </Select>
              </>
            ) : (
              <>
                <Select
                  label="X Axis"
                  value={xConfig?.fieldName ?? ""}
                  setValue={(v) => {
                    if (!v) return;
                    const type = getInferredFieldType(v);
                    onDataVizConfigChange(
                      setXAxisConfig(dataVizConfig, {
                        fieldName: v,
                        type,
                        sort:
                          type !== "string" ? "asc" : (xConfig?.sort ?? "none"),
                        dateAggregationUnit: "day",
                      }),
                    );
                  }}
                  size="2"
                  placeholder="Select X Axis"
                >
                  {axisKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </Select>
                {xConfig && (
                  <Flex direction="column" gap="2">
                    <Flex direction="row" justify="between" align="center">
                      <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                        Type
                      </Text>
                      <Select
                        style={{ flex: 1 }}
                        value={xConfig.type}
                        setValue={(v) => {
                          if (!v || !xConfig) return;
                          onDataVizConfigChange(
                            updateXAxisConfig(dataVizConfig, {
                              type: v as "string" | "number" | "date",
                            }),
                          );
                        }}
                        size="2"
                        placeholder="Select type"
                      >
                        <SelectItem value="string">String</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                      </Select>
                    </Flex>

                    {xConfig.type === "date" && (
                      <Flex direction="row" align="center">
                        <Box flexGrow="1">
                          <Text as="label" size="2" mr="2">
                            Granularity
                          </Text>
                        </Box>
                        <Select
                          value={xConfig.dateAggregationUnit}
                          style={{ flex: 1 }}
                          setValue={(v) => {
                            if (!xConfig) return;
                            onDataVizConfigChange(
                              updateXAxisConfig(dataVizConfig, {
                                dateAggregationUnit:
                                  v as xAxisDateAggregationUnit,
                              }),
                            );
                          }}
                          size="2"
                          placeholder="Select granularity"
                        >
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="second">Second</SelectItem>
                          <SelectItem value="minute">Minute</SelectItem>
                          <SelectItem value="hour">Hour</SelectItem>
                          <SelectItem value="day">Day</SelectItem>
                          <SelectItem value="week">Week</SelectItem>
                          <SelectItem value="month">Month</SelectItem>
                          <SelectItem value="year">Year</SelectItem>
                        </Select>
                      </Flex>
                    )}

                    {xConfig.type === "string" && (
                      <Flex direction="row" justify="between" align="center">
                        <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                          Sort
                        </Text>
                        <Select
                          value={xConfig.sort}
                          style={{ flex: 1 }}
                          setValue={(v) => {
                            if (!v || !xConfig) return;
                            onDataVizConfigChange(
                              updateXAxisConfig(dataVizConfig, {
                                sort: v as
                                  | "none"
                                  | "asc"
                                  | "desc"
                                  | "valueAsc"
                                  | "valueDesc",
                              }),
                            );
                          }}
                          size="2"
                          placeholder="Select sort"
                        >
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="asc">A to Z</SelectItem>
                          <SelectItem value="desc">Z to A</SelectItem>
                          <SelectItem value="valueAsc">Small to Big</SelectItem>
                          <SelectItem value="valueDesc">
                            Big to Small
                          </SelectItem>
                        </Select>
                      </Flex>
                    )}
                  </Flex>
                )}
                <Separator size="4" my={"2"} />
                <Select
                  label="Y Axis"
                  value={dataVizConfig.yAxis?.[0]?.fieldName ?? ""}
                  setValue={(v) => {
                    if (!v) return;
                    const type = getInferredFieldType(v);
                    const oldType = dataVizConfig.yAxis?.[0]?.type;

                    onDataVizConfigChange({
                      ...dataVizConfig,
                      yAxis: [
                        {
                          fieldName: v,
                          type,
                          aggregation:
                            type === "string" || type === "date"
                              ? "count"
                              : oldType !== "number" && type === "number"
                                ? "sum"
                                : dataVizConfig.yAxis?.[0]?.aggregation ||
                                  "sum",
                        },
                      ],
                    });
                  }}
                  size="2"
                  placeholder="Select Y Axis"
                >
                  {axisKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </Select>
                {dataVizConfig.yAxis?.[0] && (
                  <Flex direction="column" gap="2">
                    <Flex direction="row" justify="between" align="center">
                      <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                        Type
                      </Text>
                      <Select
                        style={{ flex: 1 }}
                        value={dataVizConfig.yAxis?.[0]?.type}
                        setValue={(v) => {
                          if (!v || !dataVizConfig.yAxis?.[0]) return;
                          onDataVizConfigChange({
                            ...dataVizConfig,
                            yAxis: [
                              {
                                ...dataVizConfig.yAxis[0],
                                type: v as "string" | "number" | "date",
                              },
                            ],
                          });
                        }}
                        size="2"
                        placeholder="Select type"
                      >
                        <SelectItem value="string">String</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                      </Select>
                    </Flex>
                    <Flex direction="row" justify="between" align="center">
                      <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                        Aggregation
                      </Text>
                      <Select
                        key={`aggregation-${dataVizConfig.yAxis?.[0]?.type}`}
                        value={dataVizConfig.yAxis?.[0]?.aggregation}
                        style={{ flex: 1 }}
                        setValue={(v) => {
                          if (!dataVizConfig.yAxis) return;
                          onDataVizConfigChange({
                            ...dataVizConfig,
                            yAxis: [
                              {
                                ...dataVizConfig.yAxis?.[0],
                                aggregation: v as yAxisAggregationType,
                              },
                            ],
                          });
                        }}
                        size="2"
                        placeholder="Select"
                      >
                        {dataVizConfig.yAxis?.[0].type === "number" ? (
                          <>
                            {((xConfig && xConfig.type !== "date") ||
                              (xConfig &&
                                xConfig.dateAggregationUnit === "none")) && (
                              <SelectItem value="none">None</SelectItem>
                            )}
                            <SelectItem value="sum">Sum</SelectItem>
                            <SelectItem value="average">Average</SelectItem>
                            <SelectItem value="min">Min</SelectItem>
                            <SelectItem value="max">Max</SelectItem>
                            <SelectItem value="first">First</SelectItem>
                            <SelectItem value="last">Last</SelectItem>
                          </>
                        ) : null}
                        <SelectItem value="countDistinct">
                          Count Distinct
                        </SelectItem>
                        <SelectItem value="count">Count</SelectItem>
                      </Select>
                    </Flex>
                  </Flex>
                )}
              </>
            )}
          </Flex>
        </Box>
      </Collapsible>
    </Flex>
  );
}
