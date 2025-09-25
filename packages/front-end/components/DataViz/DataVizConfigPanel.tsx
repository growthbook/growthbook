import { useCallback, useEffect, useMemo } from "react";
import { Box, Flex, Separator, Text, TextField } from "@radix-ui/themes";
import {
  DataVizConfig,
  xAxisDateAggregationUnit,
  yAxisAggregationType,
  BigValueFormat,
  xAxisConfiguration,
} from "back-end/src/validators/saved-queries";
import { PiWrench } from "react-icons/pi";
import { Select, SelectItem } from "@/ui/Select";
import { requiresXAxis } from "@/services/dataVizTypeGuards";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";
import DataVizFilterPanel from "./DataVizFilterPanel";
import DataVizDimensionPanel from "./DataVizDimensionPanel";

export function inferFieldType(
  sampleRow: Record<string, unknown>,
  fieldName: string,
): "string" | "number" | "date" {
  const value = sampleRow[fieldName];

  if (value == null) {
    return "string"; // Default to string if value is null or undefined
  }

  if (value instanceof Date) {
    return "date";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "string") {
    const datePattern =
      /^(\d{4}-\d{2}-\d{2}(T.*)?|\d{2}\/\d{2}\/\d{4}|[A-Za-z]{3,9} \d{1,2}, \d{4})$/;
    if (datePattern.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return "date";
      }
    }

    const cleanValue = value.replace(/,|\./g, "");
    if (
      cleanValue &&
      !isNaN(Number(cleanValue)) &&
      isFinite(Number(cleanValue))
    ) {
      return "number";
    }
  }

  return "string";
}

export default function DataVizConfigPanel({
  rows,
  dataVizConfig,
  onDataVizConfigChange,
}: {
  rows: Record<string, unknown>[];
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
}) {
  const getInferredFieldType = useCallback(
    (fieldName: string): xAxisConfiguration["type"] => {
      return inferFieldType(rows[0], fieldName);
    },
    [rows],
  );

  const axisKeys = useMemo(() => {
    return Object.keys(rows[0]);
  }, [rows]);

  useEffect(() => {
    if (requiresXAxis(dataVizConfig) && dataVizConfig.xAxis) {
      const type = dataVizConfig.xAxis.type;
      const currentSort = dataVizConfig.xAxis.sort;

      // Non-string axes should default to ascending sort
      if (type !== "string" && currentSort !== "asc") {
        onDataVizConfigChange({
          ...dataVizConfig,
          xAxis: { ...dataVizConfig.xAxis, sort: "asc" },
        });
      }
    }
  }, [dataVizConfig, onDataVizConfigChange]);

  return (
    <Flex direction="column" gap="4">
      <AreaWithHeader
        header={
          <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
            <Flex align="center" gap="1">
              <PiWrench style={{ color: "var(--violet-11)" }} size={20} />
              Configuration
            </Flex>
          </Text>
        }
      >
        <Box p="4" height="fit-content">
          <Flex direction="column" gap="4">
            <Flex direction="column">
              <Text as="label" size="3" weight="medium">
                Title
              </Text>
              <TextField.Root
                size="2"
                placeholder=""
                defaultValue={dataVizConfig.title || ""}
                onBlur={(e) => {
                  onDataVizConfigChange({
                    ...dataVizConfig,
                    title: e.target.value,
                  });
                }}
                onKeyDown={(e) => {
                  // Ignore enter
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    e.preventDefault();
                    onDataVizConfigChange({
                      ...dataVizConfig,
                      title: e.target.value,
                    });
                  }
                }}
              />
            </Flex>
            <Select
              label="Graph type"
              size="2"
              value={dataVizConfig.chartType}
              placeholder="Select graph type"
              setValue={(v) => {
                if (v === "big-value") {
                  // If graph type is big value - set defaults
                  onDataVizConfigChange({
                    ...dataVizConfig,
                    chartType: "big-value",
                    format: "shortNumber",
                  });
                  return;
                }
                onDataVizConfigChange({
                  ...dataVizConfig,
                  chartType: v as DataVizConfig["chartType"],
                });
              }}
            >
              <SelectItem value="bar">Bar</SelectItem>
              <SelectItem value="line">Line</SelectItem>
              <SelectItem value="area">Area</SelectItem>
              <SelectItem value="scatter">Scatter</SelectItem>
              <SelectItem value="big-value">Big Value</SelectItem>
            </Select>

            <Separator size="4" my={"2"} />

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
                  value={
                    requiresXAxis(dataVizConfig)
                      ? (dataVizConfig.xAxis?.fieldName ?? "")
                      : ""
                  }
                  setValue={(v) => {
                    if (!v) return;
                    const type = getInferredFieldType(v);
                    onDataVizConfigChange({
                      ...dataVizConfig,
                      xAxis: {
                        fieldName: v,
                        type,
                        sort:
                          type !== "string"
                            ? "asc"
                            : requiresXAxis(dataVizConfig) &&
                                dataVizConfig.xAxis?.sort
                              ? dataVizConfig.xAxis.sort
                              : "none",
                        // TODO: infer date aggregation unit based on data
                        dateAggregationUnit: "day",
                      },
                    });
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
                {requiresXAxis(dataVizConfig) && dataVizConfig.xAxis && (
                  <Flex direction="column" gap="2">
                    <Flex direction="row" justify="between" align="center">
                      <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                        Type
                      </Text>
                      <Select
                        style={{ flex: 1 }}
                        value={dataVizConfig.xAxis.type}
                        setValue={(v) => {
                          if (
                            !v ||
                            !requiresXAxis(dataVizConfig) ||
                            !dataVizConfig.xAxis
                          )
                            return;
                          onDataVizConfigChange({
                            ...dataVizConfig,
                            xAxis: {
                              ...dataVizConfig.xAxis,
                              type: v as "string" | "number" | "date",
                            },
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

                    {dataVizConfig.xAxis.type === "date" && (
                      <>
                        <Flex direction="row" align="center">
                          <Box flexGrow="1">
                            <Text as="label" size="2" mr="2">
                              Granularity
                            </Text>
                          </Box>
                          <Select
                            value={dataVizConfig.xAxis.dateAggregationUnit}
                            style={{ flex: 1 }}
                            setValue={(v) => {
                              if (
                                !requiresXAxis(dataVizConfig) ||
                                !dataVizConfig.xAxis
                              )
                                return;
                              onDataVizConfigChange({
                                ...dataVizConfig,
                                xAxis: {
                                  ...dataVizConfig.xAxis,
                                  dateAggregationUnit:
                                    v as xAxisDateAggregationUnit,
                                },
                              });
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
                      </>
                    )}

                    {dataVizConfig.xAxis.type === "string" && (
                      <Flex direction="row" justify="between" align="center">
                        <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                          Sort
                        </Text>
                        <Select
                          value={dataVizConfig.xAxis.sort}
                          style={{ flex: 1 }}
                          setValue={(v) => {
                            if (
                              !v ||
                              !requiresXAxis(dataVizConfig) ||
                              !dataVizConfig.xAxis
                            )
                              return;
                            onDataVizConfigChange({
                              ...dataVizConfig,
                              xAxis: {
                                ...dataVizConfig.xAxis,
                                sort: v as
                                  | "none"
                                  | "asc"
                                  | "desc"
                                  | "valueAsc"
                                  | "valueDesc",
                              },
                            });
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
                            {((requiresXAxis(dataVizConfig) &&
                              dataVizConfig.xAxis?.type !== "date") ||
                              (requiresXAxis(dataVizConfig) &&
                                dataVizConfig.xAxis?.dateAggregationUnit ===
                                  "none")) && (
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
      </AreaWithHeader>
      <DataVizDimensionPanel
        dataVizConfig={dataVizConfig}
        onDataVizConfigChange={onDataVizConfigChange}
        axisKeys={axisKeys}
      />
      <DataVizFilterPanel
        dataVizConfig={dataVizConfig}
        onDataVizConfigChange={onDataVizConfigChange}
        rows={rows}
      />
    </Flex>
  );
}
