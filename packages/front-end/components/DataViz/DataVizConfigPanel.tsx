import { useMemo, useCallback, useEffect, useState } from "react";
import { Box, Flex, Separator, Text, TextField } from "@radix-ui/themes";
import {
  DataVizConfig,
  FilterConfiguration,
  xAxisDateAggregationUnit,
  yAxisAggregationType,
} from "back-end/src/validators/saved-queries";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { Select, SelectItem } from "@/components/Radix/Select";
import MultiSelectField from "@/components/Forms/MultiSelectField";

function inferFieldType(
  sampleRow: Record<string, unknown>,
  fieldName: string
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
}

const filterOptions = [
  // Date filters
  { value: "today", label: "Today", supportedTypes: ["date"] },
  { value: "last7Days", label: "Last 7 Days", supportedTypes: ["date"] },
  { value: "last30Days", label: "Last 30 Days", supportedTypes: ["date"] },
  { value: "dateRange", label: "Custom Date Range", supportedTypes: ["date"] },

  // Number filters
  { value: "numberRange", label: "Custom Range", supportedTypes: ["number"] },
  { value: "greaterThan", label: "Greater Than", supportedTypes: ["number"] },
  { value: "lessThan", label: "Less Than", supportedTypes: ["number"] },
  { value: "equals", label: "Equals", supportedTypes: ["number"] },

  // String filters
  { value: "includes", label: "Select Values", supportedTypes: ["string"] },
  { value: "contains", label: "Text Search", supportedTypes: ["string"] },
];

function getUniqueValuesFromColumn(
  rows: Record<string, unknown>[],
  columnName: string
): string[] {
  const uniqueValues = new Set<string>();

  rows.forEach((row) => {
    const value = row[columnName];
    if (value != null) {
      uniqueValues.add(String(value));
    }
  });

  return Array.from(uniqueValues).sort();
}

type ColumnFilterOption = {
  column: string;
  knownType?: "date" | "number" | "string";
};

function getColumnFilterOptions(
  dataVizConfig: Partial<DataVizConfig>,
  sampleRow: Record<string, unknown>
) {
  const filterableColumns: ColumnFilterOption[] = [];
  if (
    dataVizConfig.xAxis?.type === "date" ||
    dataVizConfig.xAxis?.type === "number"
  ) {
    filterableColumns.push({
      column: dataVizConfig.xAxis.fieldName,
      knownType: dataVizConfig.xAxis.type,
    });
  }
  if (
    dataVizConfig.yAxis?.[0]?.type === "date" ||
    dataVizConfig.yAxis?.[0]?.type === "number"
  ) {
    filterableColumns.push({
      column: dataVizConfig.yAxis[0].fieldName,
      knownType: dataVizConfig.yAxis[0].type,
    });
  }

  // Add all columns from sample data (including strings now)
  Object.keys(sampleRow).forEach((sampleRowColumn) => {
    if (
      !filterableColumns.some((column) => column.column === sampleRowColumn)
    ) {
      const inferredType = inferFieldType(sampleRow, sampleRowColumn);
      filterableColumns.push({
        column: sampleRowColumn,
        knownType: inferredType,
      });
    }
  });

  return filterableColumns;
}

export default function DataVizConfigPanel({
  sampleRow,
  rows,
  dataVizConfig,
  onDataVizConfigChange,
}: {
  sampleRow: Record<string, unknown>;
  rows?: Record<string, unknown>[];
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
}) {
  console.log("sampleRow", sampleRow);
  const [columnFilterOptions, setColumnFilterOptions] = useState<
    ColumnFilterOption[]
  >(() => getColumnFilterOptions(dataVizConfig, sampleRow));

  const getInferredFieldType = useCallback(
    (fieldName: string): "string" | "number" | "date" => {
      return inferFieldType(sampleRow, fieldName);
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

  useEffect(() => {
    const columnFilterOptions = getColumnFilterOptions(
      dataVizConfig,
      sampleRow
    );
    setColumnFilterOptions(columnFilterOptions);
  }, [dataVizConfig, sampleRow]);

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
      </Select>

      <Separator size="4" my={"2"} />

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
                    dataVizConfig.xAxis?.dateAggregationUnit === "none") && (
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
              <SelectItem value="countDistinct">Count Distinct</SelectItem>
              <SelectItem value="count">Count</SelectItem>
            </Select>
          </Flex>
        </Flex>
      )}

      <Separator size="4" my={"2"} />

      <Collapsible
        trigger={
          <Flex direction="row" justify="between" align="center">
            <Text
              as="label"
              size="3"
              weight="medium"
              mr="2"
              mb="0"
              style={{ flex: 1 }}
            >
              Dimensions ({dataVizConfig.dimension?.length || 0})
            </Text>
            <FaAngleRight className="chevron ml-1" />
          </Flex>
        }
      >
        <Flex direction="column" gap="2" mt="2">
          <Select
            // label="Dimension"
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
        </Flex>
      </Collapsible>

      {/* MKTODO: This needs a refactor with the lastest changes */}
      {columnFilterOptions.length > 0 ? (
        <>
          <Separator size="4" my={"2"} />
          <Collapsible
            trigger={
              <Flex direction="row" justify="between" align="center">
                <Text
                  as="label"
                  size="3"
                  weight="medium"
                  mr="2"
                  mb="0"
                  style={{ flex: 1 }}
                >
                  Filters ({dataVizConfig.filter?.length || 0})
                </Text>
                <FaAngleRight className="chevron ml-1" />
              </Flex>
            }
          >
            <Flex direction="column" gap="2" mt="2">
              <Select
                // So the filter property on the dataVizConfig needs to be an array of filter objects. Needs: fieldName, operator, value
                // Does the filter need to be an array of arrays to handle range filters? E.g. if the user wants to filter by date range, it'd be [{filedName: "date", operator}]
                value={dataVizConfig.filter?.[0]?.column ?? ""}
                setValue={(v) => {
                  if (!v) return;
                  const shouldRemove = !v || v === "remove-filter";
                  // This is a hack - we'll need to handle adding/removing filters and replacing filters. But for now, we'll just support a single filter
                  onDataVizConfigChange({
                    ...dataVizConfig,
                    filter: shouldRemove
                      ? undefined
                      : [
                          {
                            column: v,
                            type:
                              //MKTODO: Is there not a better way to handle this - I don't like having to have a fallback
                              columnFilterOptions.find(
                                (option) => option.column === v
                              )?.knownType || getInferredFieldType(v),
                            filterType:
                              v === "date"
                                ? "today"
                                : v === "number"
                                ? "equals"
                                : "contains",
                          },
                        ],
                  });
                }}
                size="2"
                placeholder="Select a column to filter by"
              >
                {dataVizConfig.filter?.[0] && (
                  <SelectItem value="remove-filter">
                    - Remove filter -
                  </SelectItem>
                )}
                {columnFilterOptions.map((option, i) => (
                  <SelectItem
                    key={`${option.column}-${i}`}
                    value={option.column}
                  >
                    {option.column}
                  </SelectItem>
                ))}
              </Select>
              {dataVizConfig.filter?.[0] ? (
                <>
                  <Flex direction="column" gap="2">
                    <Flex direction="row" justify="between" align="center">
                      <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                        Type
                      </Text>
                      <Select
                        style={{ flex: 1 }}
                        value={dataVizConfig.filter[0].type}
                        setValue={(v) => {
                          if (!v || !dataVizConfig.filter?.[0]) return;

                          const currentFilter = dataVizConfig.filter[0];
                          onDataVizConfigChange({
                            ...dataVizConfig,
                            filter: [
                              {
                                ...currentFilter,
                                type: v as "string" | "number" | "date",
                                // Clear config and set appropriate default filterType when changing type
                                filterType:
                                  v === "date"
                                    ? "today"
                                    : v === "number"
                                    ? "equals"
                                    : "contains",
                                config: {},
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
                      {dataVizConfig.filter?.[0].type === "date" ? (
                        <>
                          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                            Filter Options
                          </Text>
                          <Select
                            style={{ flex: 1 }}
                            size="2"
                            placeholder="Select Option"
                            value={dataVizConfig.filter?.[0]?.filterType || ""}
                            setValue={(v) => {
                              if (!v || !dataVizConfig.filter?.[0]) return;

                              const currentFilter = dataVizConfig.filter[0];
                              onDataVizConfigChange({
                                ...dataVizConfig,
                                filter: [
                                  {
                                    ...currentFilter,
                                    filterType: v as FilterConfiguration["filterType"],
                                    // Clear config when changing filter type
                                    config: {},
                                  },
                                ],
                              });
                            }}
                          >
                            {filterOptions
                              .filter(
                                (filterOption) =>
                                  dataVizConfig.filter?.[0]?.type &&
                                  filterOption.supportedTypes.includes(
                                    dataVizConfig.filter[0].type
                                  )
                              )
                              .map((filterOption) => (
                                <SelectItem
                                  key={filterOption.value}
                                  value={filterOption.value}
                                >
                                  {filterOption.label}
                                </SelectItem>
                              ))}
                          </Select>
                        </>
                      ) : dataVizConfig.filter?.[0].type === "number" ? (
                        <>
                          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                            Filter Options
                          </Text>
                          <Select
                            style={{ flex: 1 }}
                            size="2"
                            placeholder="Select Option"
                            value={dataVizConfig.filter?.[0]?.filterType || ""}
                            setValue={(v) => {
                              if (!v || !dataVizConfig.filter?.[0]) return;

                              const currentFilter = dataVizConfig.filter[0];
                              onDataVizConfigChange({
                                ...dataVizConfig,
                                filter: [
                                  {
                                    ...currentFilter,
                                    filterType: v as FilterConfiguration["filterType"],
                                    // Clear config when changing filter type
                                    config: {},
                                  },
                                ],
                              });
                            }}
                          >
                            {filterOptions
                              .filter(
                                (filterOption) =>
                                  dataVizConfig.filter?.[0]?.type &&
                                  filterOption.supportedTypes.includes(
                                    dataVizConfig.filter[0].type
                                  )
                              )
                              .map((filterOption) => (
                                <SelectItem
                                  key={filterOption.value}
                                  value={filterOption.value}
                                >
                                  {filterOption.label}
                                </SelectItem>
                              ))}
                          </Select>
                        </>
                      ) : dataVizConfig.filter?.[0].type === "string" ? (
                        <>
                          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                            Filter Options
                          </Text>
                          <Select
                            style={{ flex: 1 }}
                            size="2"
                            placeholder="Select Option"
                            value={dataVizConfig.filter?.[0]?.filterType || ""}
                            setValue={(v) => {
                              if (!v || !dataVizConfig.filter?.[0]) return;

                              const currentFilter = dataVizConfig.filter[0];
                              onDataVizConfigChange({
                                ...dataVizConfig,
                                filter: [
                                  {
                                    ...currentFilter,
                                    filterType: v as FilterConfiguration["filterType"],
                                    // Clear config when changing filter type
                                    config: {},
                                  },
                                ],
                              });
                            }}
                          >
                            {filterOptions
                              .filter(
                                (filterOption) =>
                                  dataVizConfig.filter?.[0]?.type &&
                                  filterOption.supportedTypes.includes(
                                    dataVizConfig.filter[0].type
                                  )
                              )
                              .map((filterOption) => (
                                <SelectItem
                                  key={filterOption.value}
                                  value={filterOption.value}
                                >
                                  {filterOption.label}
                                </SelectItem>
                              ))}
                          </Select>
                        </>
                      ) : null}
                    </Flex>

                    {/* Custom Date Range Inputs */}
                    {dataVizConfig.filter?.[0]?.filterType === "dateRange" && (
                      <>
                        <Flex direction="row" justify="between" align="center">
                          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                            Start Date
                          </Text>
                          <TextField.Root
                            style={{ flex: 1 }}
                            size="2"
                            type="date"
                            value={String(
                              dataVizConfig.filter[0].config?.startDate || ""
                            )}
                            onChange={(e) => {
                              if (!dataVizConfig.filter?.[0]) return;

                              const currentFilter = dataVizConfig.filter[0];
                              onDataVizConfigChange({
                                ...dataVizConfig,
                                filter: [
                                  {
                                    ...currentFilter,
                                    config: {
                                      ...currentFilter.config,
                                      startDate: e.target.value,
                                    },
                                  },
                                ],
                              });
                            }}
                          />
                        </Flex>

                        <Flex direction="row" justify="between" align="center">
                          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                            End Date
                          </Text>
                          <TextField.Root
                            style={{ flex: 1 }}
                            size="2"
                            type="date"
                            value={String(
                              dataVizConfig.filter[0].config?.endDate || ""
                            )}
                            onChange={(e) => {
                              if (!dataVizConfig.filter?.[0]) return;

                              const currentFilter = dataVizConfig.filter[0];
                              onDataVizConfigChange({
                                ...dataVizConfig,
                                filter: [
                                  {
                                    ...currentFilter,
                                    config: {
                                      ...currentFilter.config,
                                      endDate: e.target.value,
                                    },
                                  },
                                ],
                              });
                            }}
                          />
                        </Flex>
                      </>
                    )}

                    {/* Number Filter Inputs */}
                    {dataVizConfig.filter?.[0]?.type === "number" &&
                      dataVizConfig.filter?.[0]?.filterType ===
                        "numberRange" && (
                        <>
                          <Flex
                            direction="row"
                            justify="between"
                            align="center"
                          >
                            <Text
                              as="label"
                              size="2"
                              mr="2"
                              style={{ flex: 1 }}
                            >
                              Min Value
                            </Text>
                            <TextField.Root
                              style={{ flex: 1 }}
                              size="2"
                              type="number"
                              placeholder="Minimum"
                              value={
                                dataVizConfig.filter[0].config?.min?.toString() ||
                                ""
                              }
                              onChange={(e) => {
                                if (!dataVizConfig.filter?.[0]) return;

                                const currentFilter = dataVizConfig.filter[0];
                                const value = e.target.value
                                  ? Number(e.target.value)
                                  : undefined;

                                // Only update config with defined values
                                const newConfig = { ...currentFilter.config };
                                if (value !== undefined) {
                                  newConfig.min = value;
                                } else {
                                  delete newConfig.min;
                                }

                                onDataVizConfigChange({
                                  ...dataVizConfig,
                                  filter: [
                                    {
                                      ...currentFilter,
                                      config: newConfig,
                                    },
                                  ],
                                });
                              }}
                            />
                          </Flex>

                          <Flex
                            direction="row"
                            justify="between"
                            align="center"
                          >
                            <Text
                              as="label"
                              size="2"
                              mr="2"
                              style={{ flex: 1 }}
                            >
                              Max Value
                            </Text>
                            <TextField.Root
                              style={{ flex: 1 }}
                              size="2"
                              type="number"
                              placeholder="Maximum"
                              value={
                                dataVizConfig.filter[0].config?.max?.toString() ||
                                ""
                              }
                              onChange={(e) => {
                                if (!dataVizConfig.filter?.[0]) return;

                                const currentFilter = dataVizConfig.filter[0];
                                const value = e.target.value
                                  ? Number(e.target.value)
                                  : undefined;

                                // Only update config with defined values
                                const newConfig = { ...currentFilter.config };
                                if (value !== undefined) {
                                  newConfig.max = value;
                                } else {
                                  delete newConfig.max;
                                }

                                onDataVizConfigChange({
                                  ...dataVizConfig,
                                  filter: [
                                    {
                                      ...currentFilter,
                                      config: newConfig,
                                    },
                                  ],
                                });
                              }}
                            />
                          </Flex>
                        </>
                      )}

                    {/* Single Value Number Filters */}
                    {dataVizConfig.filter?.[0]?.type === "number" &&
                      (dataVizConfig.filter?.[0]?.filterType ===
                        "greaterThan" ||
                        dataVizConfig.filter?.[0]?.filterType === "lessThan" ||
                        dataVizConfig.filter?.[0]?.filterType === "equals") && (
                        <Flex direction="row" justify="between" align="center">
                          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                            Value
                          </Text>
                          <TextField.Root
                            style={{ flex: 1 }}
                            size="2"
                            type="number"
                            placeholder="Enter value"
                            value={
                              dataVizConfig.filter[0].config?.value?.toString() ||
                              ""
                            }
                            onChange={(e) => {
                              if (!dataVizConfig.filter?.[0]) return;

                              const currentFilter = dataVizConfig.filter[0];
                              const value = e.target.value
                                ? Number(e.target.value)
                                : undefined;

                              // Only update config with defined values
                              const newConfig = { ...currentFilter.config };
                              if (value !== undefined) {
                                newConfig.value = value;
                              } else {
                                delete newConfig.value;
                              }

                              onDataVizConfigChange({
                                ...dataVizConfig,
                                filter: [
                                  {
                                    ...currentFilter,
                                    config: newConfig,
                                  },
                                ],
                              });
                            }}
                          />
                        </Flex>
                      )}

                    {/* String Filter Inputs */}
                    {dataVizConfig.filter?.[0]?.type === "string" &&
                      dataVizConfig.filter?.[0]?.filterType === "contains" && (
                        <Flex direction="row" justify="between" align="center">
                          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                            Search Text
                          </Text>
                          <TextField.Root
                            style={{ flex: 1 }}
                            size="2"
                            type="text"
                            placeholder="Enter text to search for"
                            value={String(
                              dataVizConfig.filter[0].config?.value || ""
                            )}
                            onChange={(e) => {
                              if (!dataVizConfig.filter?.[0]) return;

                              const currentFilter = dataVizConfig.filter[0];
                              const value = e.target.value;

                              // Only update config with defined values
                              const newConfig = { ...currentFilter.config };
                              if (value) {
                                newConfig.value = value;
                              } else {
                                delete newConfig.value;
                              }

                              onDataVizConfigChange({
                                ...dataVizConfig,
                                filter: [
                                  {
                                    ...currentFilter,
                                    config: newConfig,
                                  },
                                ],
                              });
                            }}
                          />
                        </Flex>
                      )}

                    {/* String Multi-Select Filter */}
                    {dataVizConfig.filter?.[0]?.type === "string" &&
                      dataVizConfig.filter?.[0]?.filterType === "includes" &&
                      rows && (
                        <Flex direction="column" gap="2">
                          {(() => {
                            const columnName = dataVizConfig.filter[0].column;
                            const uniqueValues = getUniqueValuesFromColumn(
                              rows,
                              columnName
                            );
                            const selectedValues = Array.isArray(
                              dataVizConfig.filter[0].config?.values
                            )
                              ? (dataVizConfig.filter[0].config
                                  .values as string[])
                              : [];

                            return (
                              <>
                                <MultiSelectField
                                  label="Select Values"
                                  value={selectedValues}
                                  options={uniqueValues.map((value) => ({
                                    label: value,
                                    value,
                                  }))}
                                  onChange={(newValues) => {
                                    if (!dataVizConfig.filter?.[0]) return;

                                    const currentFilter =
                                      dataVizConfig.filter[0];
                                    const newConfig: Record<string, any> = {
                                      ...currentFilter.config,
                                    };

                                    if (newValues.length > 0) {
                                      newConfig.values = newValues;
                                    } else {
                                      delete newConfig.values;
                                    }

                                    onDataVizConfigChange({
                                      ...dataVizConfig,
                                      filter: [
                                        {
                                          ...currentFilter,
                                          config: newConfig,
                                        },
                                      ],
                                    });
                                  }}
                                  placeholder="Select values to filter by..."
                                  closeMenuOnSelect={false}
                                />

                                {/* Selection count */}
                                <Text size="1" color="gray">
                                  {selectedValues.length} of{" "}
                                  {uniqueValues.length} values selected
                                </Text>
                              </>
                            );
                          })()}
                        </Flex>
                      )}
                  </Flex>
                </>
              ) : null}
            </Flex>
          </Collapsible>
        </>
      ) : null}
    </Flex>
  );
}
