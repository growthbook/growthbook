import { useMemo, useCallback, useEffect } from "react";
import { Box, Flex, Separator, Text, TextField } from "@radix-ui/themes";
import {
  DataVizConfig,
  xAxisConfiguration,
  xAxisDateAggregationUnit,
  yAxisAggregationType,
} from "back-end/src/validators/saved-queries";
import { Select, SelectItem } from "@/components/Radix/Select";

export default function DataVizConfigPanel({
  sampleRow,
  dataVizConfig,
  onDataVizConfigChange,
}: {
  sampleRow: Record<string, unknown>;
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
}) {
  const getInferredFieldType = useCallback(
    (fieldName: string): xAxisConfiguration["type"] => {
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
        const datePattern = /^(\d{4}-\d{2}-\d{2}(T.*)?|\d{2}\/\d{2}\/\d{4}|[A-Za-z]{3,9} \d{1,2}, \d{4})$/;
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
    },
    [sampleRow]
  );

  const axisKeys = useMemo(() => {
    return Object.keys(sampleRow);
  }, [sampleRow]);

  useEffect(() => {
    if (dataVizConfig.xAxis) {
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
      <Flex direction="column">
        <Text as="label" size="3" weight="medium">
          Title
        </Text>
        <TextField.Root
          size="3"
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
        value={dataVizConfig.chartType}
        placeholder="Select graph type"
        setValue={(v) => {
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
              //MKTODO: Validate this number logic
              .filter((key) => typeof sampleRow[key] === "number")
              .map((key) => (
                <SelectItem key={key} value={key}>
                  {key}
                </SelectItem>
              ))}
          </Select>
          <Select
            label="Aggregation"
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
            value={dataVizConfig.xAxis?.fieldName ?? ""}
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
                      : dataVizConfig.xAxis?.sort || "none",
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

          {dataVizConfig.xAxis && (
            <Flex direction="column" gap="2">
              <Flex direction="row" justify="between" align="center">
                <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                  Type
                </Text>
                <Select
                  style={{ flex: 1 }}
                  value={dataVizConfig.xAxis.type}
                  setValue={(v) => {
                    if (!v || !dataVizConfig.xAxis) return;
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
                        if (!dataVizConfig.xAxis) return;
                        onDataVizConfigChange({
                          ...dataVizConfig,
                          xAxis: {
                            ...dataVizConfig.xAxis,
                            dateAggregationUnit: v as xAxisDateAggregationUnit,
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
                      if (!v || !dataVizConfig.xAxis) return;
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
                    <SelectItem value="valueDesc">Big to Small</SelectItem>
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
                        : dataVizConfig.yAxis?.[0]?.aggregation || "sum",
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
                      {(dataVizConfig.xAxis?.type !== "date" ||
                        dataVizConfig.xAxis?.dateAggregationUnit ===
                          "none") && <SelectItem value="none">None</SelectItem>}
                      <SelectItem value="sum">Sum</SelectItem>
                      <SelectItem value="average">Average</SelectItem>
                      <SelectItem value="min">Min</SelectItem>
                      <SelectItem value="max">Max</SelectItem>
                      <SelectItem value="first">First</SelectItem>
                      <SelectItem value="last">Last</SelectItem>
                    </>
                  ) : null}
                  <SelectItem value="countDistinct">Count Distinct</SelectItem>
                  <SelectItem value="count">Count</SelectItem>
                </Select>
              </Flex>
            </Flex>
          )}

          <Separator size="4" my={"2"} />

          <Select
            label="Dimension"
            value={dataVizConfig.dimension?.[0]?.fieldName ?? ""}
            setValue={(v) => {
              const shouldRemove = !v || v === "remove-dimension";
              const display =
                dataVizConfig.chartType !== "bar"
                  ? "grouped"
                  : dataVizConfig.dimension?.[0]?.display || "grouped";
              onDataVizConfigChange({
                ...dataVizConfig,
                dimension: shouldRemove
                  ? undefined
                  : [
                      {
                        fieldName: v,
                        display,
                        maxValues: dataVizConfig.dimension?.[0]?.maxValues || 5,
                      },
                    ],
              });
            }}
            size="2"
            placeholder="Select a dimension"
          >
            {dataVizConfig.dimension?.[0]?.fieldName && (
              <SelectItem value="remove-dimension">
                - Remove dimension -
              </SelectItem>
            )}
            {axisKeys.map((key) => (
              <SelectItem key={key} value={key}>
                {key}
              </SelectItem>
            ))}
          </Select>

          {dataVizConfig.dimension && (
            <>
              <Flex direction="column" gap="2">
                {(dataVizConfig.chartType === "bar" ||
                  dataVizConfig.chartType === "area") && (
                  <Flex direction="row" justify="between" align="center">
                    <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                      Display
                    </Text>
                    <Select
                      style={{ flex: 1 }}
                      value={dataVizConfig.dimension?.[0]?.display}
                      setValue={(v) => {
                        if (!dataVizConfig.dimension) return;
                        onDataVizConfigChange({
                          ...dataVizConfig,
                          dimension: [
                            {
                              ...dataVizConfig.dimension?.[0],
                              display: v as "grouped" | "stacked",
                            },
                          ],
                        });
                      }}
                      size="2"
                    >
                      <SelectItem value="grouped">Grouped</SelectItem>
                      <SelectItem value="stacked">Stacked</SelectItem>
                    </Select>
                  </Flex>
                )}
                <Flex direction="row" justify="between" align="center">
                  <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                    Max Values
                  </Text>
                  <TextField.Root
                    style={{ flex: 1 }}
                    size="2"
                    min="1"
                    max="10"
                    step="1"
                    type="number"
                    defaultValue={
                      dataVizConfig.dimension?.[0]?.maxValues?.toString() || "5"
                    }
                    onBlur={(e) => {
                      const maxValues = parseInt(e.target.value, 10);
                      if (isNaN(maxValues)) return;
                      if (!dataVizConfig.dimension) return;
                      onDataVizConfigChange({
                        ...dataVizConfig,
                        dimension: [
                          {
                            ...dataVizConfig.dimension?.[0],
                            maxValues,
                          },
                        ],
                      });
                    }}
                    onKeyDown={(e) => {
                      // Ignore enter
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        e.preventDefault();

                        const maxValues = parseInt(e.target.value, 10);
                        if (isNaN(maxValues)) return;
                        if (!dataVizConfig.dimension) return;
                        onDataVizConfigChange({
                          ...dataVizConfig,
                          dimension: [
                            {
                              ...dataVizConfig.dimension?.[0],
                              maxValues,
                            },
                          ],
                        });
                      }
                    }}
                  />
                </Flex>
              </Flex>
            </>
          )}
        </>
      )}
    </Flex>
  );
}
