import { useMemo, useCallback, useEffect } from "react";
import { Flex, Separator, Text } from "@radix-ui/themes";
import {
  DataVizConfig,
  xAxisConfiguration,
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
        if (!isNaN(Number(cleanValue)) && isFinite(Number(cleanValue))) {
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

  const yAxisInferredType = useMemo(() => {
    if (!dataVizConfig.yAxis) return;
    return getInferredFieldType(dataVizConfig.yAxis[0].fieldName);
  }, [dataVizConfig.yAxis, getInferredFieldType]);

  return (
    <Flex direction="column" gap="4">
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
      </Select>

      <Separator size="4" />

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
                type !== "string" ? "asc" : dataVizConfig.xAxis?.sort || "none",
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
                      sort: v as "none" | "asc" | "desc",
                    },
                  });
                }}
                size="2"
                placeholder="Select sort"
              >
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="asc">Ascending</SelectItem>
                <SelectItem value="desc">Descending</SelectItem>
              </Select>
            </Flex>
          )}
        </Flex>
      )}

      <Select
        label="Y Axis"
        value={dataVizConfig.yAxis?.[0]?.fieldName ?? ""}
        setValue={(v) => {
          if (!v) return;
          const type = getInferredFieldType(v);
          onDataVizConfigChange({
            ...dataVizConfig,
            yAxis: [
              {
                fieldName: v,
                aggregation:
                  type === "string"
                    ? "count"
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

      {dataVizConfig.yAxis && (
        <Flex direction="column" gap="2">
          <Flex direction="row" justify="between" align="center">
            <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
              Aggregation
            </Text>
            <Select
              value={dataVizConfig.yAxis?.[0]?.aggregation}
              style={{ flex: 1 }}
              setValue={(v) => {
                if (!dataVizConfig.yAxis) return;
                onDataVizConfigChange({
                  ...dataVizConfig,
                  yAxis: [
                    {
                      ...dataVizConfig.yAxis?.[0],
                      aggregation: v as "none" | "sum" | "count" | "average",
                    },
                  ],
                });
              }}
              size="2"
              placeholder="Select aggregation"
            >
              {yAxisInferredType !== "string" ? (
                <SelectItem value="none">None</SelectItem>
              ) : null}
              <SelectItem value="count">Count</SelectItem>
              {yAxisInferredType !== "string" ? (
                <SelectItem value="sum">Sum</SelectItem>
              ) : null}
              {yAxisInferredType !== "string" ? (
                <SelectItem value="average">Average</SelectItem>
              ) : null}
            </Select>
          </Flex>
        </Flex>
      )}

      <Select
        label="Dimension"
        value={dataVizConfig.dimension?.[0]?.fieldName ?? ""}
        setValue={(v) => {
          const shouldRemove = !v || v === "remove-dimension";
          const display =
            dataVizConfig.chartType !== "bar"
              ? "grouped"
              : dataVizConfig.dimension?.[0]?.display || "grouped";
          const sort = display === "grouped" ? "asc" : "none";
          onDataVizConfigChange({
            ...dataVizConfig,
            dimension: shouldRemove
              ? undefined
              : [
                  {
                    fieldName: v,
                    display,
                    sort,
                  },
                ],
          });
        }}
        size="2"
        placeholder="Select a dimension"
      >
        {dataVizConfig.dimension?.[0]?.fieldName && (
          <SelectItem value="remove-dimension">- Remove dimension -</SelectItem>
        )}
        {axisKeys.map((key) => (
          <SelectItem key={key} value={key}>
            {key}
          </SelectItem>
        ))}
      </Select>

      {dataVizConfig.dimension && (
        <Flex direction="column" gap="2">
          {dataVizConfig.chartType === "bar" && (
            <>
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

              {dataVizConfig.dimension?.[0]?.display === "grouped" && (
                <Flex direction="row" justify="between" align="center">
                  <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                    Sort
                  </Text>
                  <Select
                    value={dataVizConfig.dimension?.[0]?.sort}
                    style={{ flex: 1 }}
                    setValue={(v) => {
                      if (!dataVizConfig.dimension) return;
                      onDataVizConfigChange({
                        ...dataVizConfig,
                        dimension: [
                          {
                            ...dataVizConfig.dimension?.[0],
                            sort: v as "none" | "asc" | "desc",
                          },
                        ],
                      });
                    }}
                    size="2"
                    placeholder="Select sort"
                  >
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </Select>
                </Flex>
              )}
            </>
          )}
        </Flex>
      )}
    </Flex>
  );
}
