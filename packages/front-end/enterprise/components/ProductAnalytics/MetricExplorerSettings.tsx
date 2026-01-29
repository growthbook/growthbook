import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
  ExploreSeries,
  ExploreSeriesType,
  ExploreValueType,
  MetricSeriesConfig,
  FactTableSeriesConfig,
} from "shared/enterprise";
import React from "react";
import { Flex, Text, Box, DropdownMenu, TextField } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import {
  PiSlidersHorizontal,
  PiChartBar,
  PiGearSix,
  PiTable,
  PiCode,
  PiPlus,
  PiTrash,
  PiPencilSimple,
} from "react-icons/pi";
import { FaAngleRight } from "react-icons/fa";
import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import PopulationChooser from "@/components/MetricAnalysis/PopulationChooser";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import {
  getSeriesLabel,
  getSeriesTag,
  SERIES_COLORS,
} from "./util";
import { getSeriesIcon } from "./Explorer";

type SeriesType = ExploreSeriesType;
type FactTableValueType = ExploreValueType;

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
  series: ExploreSeries[];
  selectedSeriesId: string | null;
  onSelectSeries: (id: string | null) => void;
  onAddSeries: (type: SeriesType) => void;
  onUpdateSeries: (id: string, updates: Partial<ExploreSeries>) => void;
  onDeleteSeries: (id: string) => void;
}

const VALUE_TYPE_OPTIONS: {
  value: FactTableValueType;
  label: string;
  description: string;
}[] = [
  { value: "count", label: "Count", description: "Count total rows" },
  {
    value: "unit_count",
    label: "Unit Count",
    description: "Count distinct units",
  },
  { value: "sum", label: "Sum", description: "Sum a numeric column" },
];

function SeriesCard({
  s,
  index,
  isOpen,
  onToggle,
  onUpdate,
  onDelete,
  block,
  setBlock,
}: {
  s: ExploreSeries;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<ExploreSeries>) => void;
  onDelete: () => void;
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
}) {
  const { getFactMetricById, getFactTableById, factMetrics, factTables } =
    useDefinitions();
  const tag = getSeriesTag(index);

  // Get display name based on series type and config
  const getDisplayName = () => {
    if (s.type === "metric") {
      const config = s.config as MetricSeriesConfig;
      if (config.factMetricId) {
        const metric = getFactMetricById(config.factMetricId);
        return metric?.name || s.name;
      }
    }
    if (s.type === "factTable") {
      const config = s.config as FactTableSeriesConfig;
      if (config.factTableId) {
        const factTable = getFactTableById(config.factTableId);
        return factTable?.name || s.name;
      }
    }
    return s.name;
  };

  // For metric series, get the metric and fact table
  const metric =
    s.type === "metric"
      ? getFactMetricById((s.config as MetricSeriesConfig).factMetricId)
      : null;
  const factTable = getFactTableById(
    s.type === "factTable"
      ? (s.config as FactTableSeriesConfig).factTableId
      : metric?.numerator?.factTableId || "",
  );

  let denominatorFactTable: FactTableInterface | null = null;
  if (metric?.denominator?.factTableId) {
    if (metric?.numerator?.factTableId !== metric?.denominator?.factTableId) {
      denominatorFactTable = getFactTableById(
        metric?.denominator?.factTableId || "",
      );
    } else {
      denominatorFactTable = factTable;
    }
  }

  // Get numeric columns for the sum value selector (Fact Table Series)
  const numericColumns =
    factTable?.columns?.filter((col) => col.datatype === "number") || [];

  return (
    <Flex
      direction="column"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        overflow: "hidden",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Collapsible
        open={isOpen}
        transitionTime={100}
        trigger={
          <div
            onClick={onToggle}
            style={{
              paddingLeft: "12px",
              paddingRight: "12px",
              paddingTop: "12px",
              paddingBottom: "12px",
              borderBottom: isOpen ? "1px solid var(--gray-a3)" : "none",
              cursor: "pointer",
            }}
          >
            <Flex justify="between" align="center">
              <Flex align="center" gap="2" style={{ flex: 1, minWidth: 0 }}>
                {/* Series Tag with Color */}
                <Flex
                  align="center"
                  justify="center"
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "var(--radius-2)",
                    backgroundColor:
                      s.color || SERIES_COLORS[index % SERIES_COLORS.length],
                    color: "white",
                    fontSize: "11px",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {tag}
                </Flex>
                <Box style={{ color: "var(--gray-11)", flexShrink: 0 }}>
                  {getSeriesIcon(s.type, 14)}
                </Box>
                <Text
                  size="2"
                  weight="medium"
                  style={{
                    color: "var(--color-text-main)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {getDisplayName()}
                </Text>
              </Flex>
              <Flex align="center" gap="1">
                <Tooltip body="Remove series">
                  <Button
                    variant="ghost"
                    size="sm"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    style={{ padding: "2px 4px" }}
                  >
                    <PiTrash size={12} />
                  </Button>
                </Tooltip>
                <FaAngleRight
                  className="chevron"
                  style={{
                    transform: isOpen ? "rotate(90deg)" : "none",
                    transition: "transform 0.2s",
                  }}
                />
              </Flex>
            </Flex>
          </div>
        }
      >
        <Box p="3">
          <Flex direction="column" gap="4">
            {/* Metric Series Config */}
            {s.type === "metric" && (
              <>
                <SelectField
                  label="Metric"
                  value={(s.config as MetricSeriesConfig).factMetricId}
                  onChange={(v) =>
                    onUpdate({
                      config: {
                        ...s.config,
                        factMetricId: v,
                      } as MetricSeriesConfig,
                    })
                  }
                  options={factMetrics.map((m) => ({
                    label: m.name,
                    value: m.id,
                  }))}
                  placeholder="Select a metric..."
                  forceUndefinedValueToNull
                />

                {metric && factTable && (
                  <>
                    {metric?.metricType !== "ratio" && (
                      <Select
                        label="Metric Value"
                        size="2"
                        value={(s.config as MetricSeriesConfig).valueType}
                        placeholder="Select value"
                        setValue={(v) =>
                          onUpdate({
                            config: {
                              ...s.config,
                              valueType: v as "sum" | "avg",
                            } as MetricSeriesConfig,
                          })
                        }
                      >
                        <SelectItem value="avg">
                          {metric?.metricType === "proportion"
                            ? "Proportion"
                            : "Average"}
                        </SelectItem>
                        <SelectItem value="sum">
                          {metric?.metricType === "proportion"
                            ? "Unit Count"
                            : "Sum"}
                        </SelectItem>
                      </Select>
                    )}

                    <Collapsible
                      transitionTime={100}
                      trigger={
                        <Flex
                          align="center"
                          justify="between"
                          py="2"
                          style={{ cursor: "pointer" }}
                        >
                          <Flex align="center" gap="1">
                            <PiGearSix
                              style={{ color: "var(--gray-9)" }}
                              size={16}
                            />
                            <Text
                              size="2"
                              style={{
                                color: "var(--color-text-mid)",
                                fontWeight: 500,
                              }}
                            >
                              Advanced
                            </Text>
                          </Flex>
                          <FaAngleRight
                            className="chevron"
                            size={12}
                            style={{ color: "var(--gray-9)" }}
                          />
                        </Flex>
                      }
                    >
                      <Flex direction="column" gap="4" pt="2">
                        <Select
                          label="Unit"
                          size="2"
                          value={block.analysisSettings.userIdType}
                          placeholder="Select unit"
                          setValue={(v) =>
                            setBlock({
                              ...block,
                              analysisSettings: {
                                ...block.analysisSettings,
                                userIdType: v,
                                populationType: "factTable",
                                populationId: "",
                              },
                            })
                          }
                        >
                          {factTable.userIdTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </Select>

                        <PopulationChooser
                          datasourceId={factTable.datasource}
                          value={
                            block.analysisSettings.populationType ?? "factTable"
                          }
                          setValue={(v, populationId) =>
                            setBlock({
                              ...block,
                              analysisSettings: {
                                ...block.analysisSettings,
                                populationId,
                                populationType: v,
                              },
                            })
                          }
                          userIdType={block.analysisSettings.userIdType}
                          newStyle
                        />
                      </Flex>
                    </Collapsible>
                  </>
                )}
              </>
            )}

            {/* Fact Table Series Config */}
            {s.type === "factTable" && (
              <>
                <SelectField
                  label="Fact Table"
                  value={(s.config as FactTableSeriesConfig).factTableId}
                  onChange={(v) =>
                    onUpdate({
                      config: {
                        ...s.config,
                        factTableId: v,
                        // Reset dependent fields when fact table changes
                        unitType: undefined,
                        valueColumn: undefined,
                      } as FactTableSeriesConfig,
                    })
                  }
                  options={factTables.map((ft) => ({
                    label: ft.name,
                    value: ft.id,
                  }))}
                  placeholder="Select a fact table..."
                  forceUndefinedValueToNull
                />

                {factTable && (
                  <>
                    <Select
                      label="Value Type"
                      size="2"
                      value={(s.config as FactTableSeriesConfig).valueType}
                      placeholder="Select value type"
                      setValue={(v) =>
                        onUpdate({
                          config: {
                            ...s.config,
                            valueType: v as FactTableValueType,
                            // Clear dependent fields when type changes
                            unitType:
                              v === "unit_count"
                                ? (s.config as FactTableSeriesConfig).unitType
                                : undefined,
                            valueColumn:
                              v === "sum"
                                ? (s.config as FactTableSeriesConfig)
                                    .valueColumn
                                : undefined,
                          } as FactTableSeriesConfig,
                        })
                      }
                    >
                      {VALUE_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </Select>

                    {(s.config as FactTableSeriesConfig).valueType ===
                      "unit_count" && (
                      <Select
                        label="Unit"
                        size="2"
                        value={
                          (s.config as FactTableSeriesConfig).unitType || ""
                        }
                        placeholder="Select unit to count"
                        setValue={(v) =>
                          onUpdate({
                            config: {
                              ...s.config,
                              unitType: v,
                            } as FactTableSeriesConfig,
                          })
                        }
                      >
                        {factTable.userIdTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </Select>
                    )}

                    {(s.config as FactTableSeriesConfig).valueType ===
                      "sum" && (
                      <Select
                        label="Value Column"
                        size="2"
                        value={
                          (s.config as FactTableSeriesConfig).valueColumn || ""
                        }
                        placeholder="Select column to sum"
                        setValue={(v) =>
                          onUpdate({
                            config: {
                              ...s.config,
                              valueColumn: v,
                            } as FactTableSeriesConfig,
                          })
                        }
                      >
                        {numericColumns.length > 0 ? (
                          numericColumns.map((col) => (
                            <SelectItem key={col.column} value={col.column}>
                              {col.column}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="" disabled>
                            No numeric columns available
                          </SelectItem>
                        )}
                      </Select>
                    )}
                  </>
                )}
              </>
            )}

            {/* SQL Series Config */}
            {s.type === "sql" && (
              <>
                <Text size="2" color="gray">
                  Write a custom SQL query to add data to your visualization.
                </Text>
                <Box
                  style={{
                    backgroundColor: "var(--gray-a2)",
                    borderRadius: "var(--radius-2)",
                    padding: "var(--space-3)",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    color: "var(--gray-9)",
                    minHeight: "80px",
                  }}
                >
                  -- SQL editor coming soon...
                </Box>
              </>
            )}

            {/* Local Filters (Metric & FactTable) */}
            {factTable && (s.type === "metric" || s.type === "factTable") && (
              <Collapsible
                trigger={
                  <Flex
                    align="center"
                    justify="between"
                    py="2"
                    style={{ cursor: "pointer" }}
                  >
                    <Flex align="center" gap="1">
                      <PiSlidersHorizontal
                        style={{ color: "var(--violet-11)" }}
                        size={16}
                      />
                      <Text
                        size="2"
                        style={{
                          color: "var(--color-text-mid)",
                          fontWeight: 500,
                        }}
                      >
                        Local Filters
                      </Text>
                      <Badge
                        label={
                          s.type === "factTable"
                            ? (
                                (s.config as FactTableSeriesConfig).rowFilters
                                  ?.length || 0
                              ).toString()
                            : (
                                (block.analysisSettings
                                  .additionalNumeratorFilters?.length || 0) +
                                (block.analysisSettings
                                  .additionalDenominatorFilters?.length || 0)
                              ).toString()
                        }
                        color="violet"
                        radius="full"
                        variant="soft"
                      />
                    </Flex>
                    <FaAngleRight
                      className="chevron"
                      size={12}
                      style={{ color: "var(--gray-9)" }}
                    />
                  </Flex>
                }
                transitionTime={100}
              >
                <Box pt="2">
                  <Flex direction="column" gap="3">
                    {s.type === "factTable" ? (
                      <RowFilterInput
                        value={
                          (s.config as FactTableSeriesConfig).rowFilters || []
                        }
                        setValue={(filters: RowFilter[]) =>
                          onUpdate({
                            config: {
                              ...s.config,
                              rowFilters: filters,
                            } as FactTableSeriesConfig,
                          })
                        }
                        factTable={factTable}
                      />
                    ) : (
                      // Metric Filters
                      <>
                        <MultiSelectField
                          label={
                            <Flex align="center" gap="1">
                              <Text as="label" size="2" weight="medium">
                                Row Filters
                              </Text>
                              {metric?.denominator?.factTableId ? (
                                <Text as="span" size="1" mb="2">
                                  {" "}
                                  (Numerator)
                                </Text>
                              ) : null}
                            </Flex>
                          }
                          value={
                            block.analysisSettings.additionalNumeratorFilters ??
                            []
                          }
                          containerClassName="mb-0"
                          labelClassName="mb-0"
                          onChange={(filters) =>
                            setBlock({
                              ...block,
                              analysisSettings: {
                                ...block.analysisSettings,
                                additionalNumeratorFilters: filters,
                              },
                            })
                          }
                          placeholder="Apply additional filters..."
                          options={
                            factTable?.filters?.map((f) => ({
                              value: f.id,
                              label: f.name,
                            })) || []
                          }
                        />
                        {metric?.denominator?.factTableId ? (
                          <MultiSelectField
                            label={
                              <Flex align="center" gap="1">
                                <Text as="label" size="2" weight="medium">
                                  Row Filters
                                </Text>
                                <Text as="span" size="1" mb="2">
                                  {" "}
                                  (Denominator)
                                </Text>
                              </Flex>
                            }
                            value={
                              block.analysisSettings
                                .additionalDenominatorFilters ?? []
                            }
                            containerClassName="mb-0"
                            labelClassName="mb-0"
                            onChange={(filters) =>
                              setBlock({
                                ...block,
                                analysisSettings: {
                                  ...block.analysisSettings,
                                  additionalDenominatorFilters: filters,
                                },
                              })
                            }
                            placeholder="Apply additional filters..."
                            options={
                              denominatorFactTable?.filters?.map((f) => ({
                                value: f.id,
                                label: f.name,
                              })) || []
                            }
                          />
                        ) : null}
                      </>
                    )}
                  </Flex>
                </Box>
              </Collapsible>
            )}

            {/* Appearance Settings */}
            <Collapsible
              trigger={
                <Flex
                  align="center"
                  justify="between"
                  py="2"
                  style={{ cursor: "pointer" }}
                >
                  <Flex align="center" gap="1">
                    <PiPencilSimple
                      style={{ color: "var(--violet-11)" }}
                      size={16}
                    />
                    <Text
                      size="2"
                      style={{
                        color: "var(--color-text-mid)",
                        fontWeight: 500,
                      }}
                    >
                      Appearance
                    </Text>
                  </Flex>
                  <FaAngleRight
                    className="chevron"
                    size={12}
                    style={{ color: "var(--gray-9)" }}
                  />
                </Flex>
              }
              transitionTime={100}
            >
              <Box pt="2">
                <Flex direction="column" gap="3">
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      Name
                    </Text>
                    <TextField.Root
                      size="2"
                      value={s.name}
                      onChange={(e) =>
                        onUpdate({
                          name: e.target.value,
                        })
                      }
                      placeholder="Series name..."
                    />
                  </Flex>
                </Flex>
              </Box>
            </Collapsible>
          </Flex>
        </Box>
      </Collapsible>
    </Flex>
  );
}

function AddSeriesButton({ onAdd }: { onAdd: (type: SeriesType) => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button variant="outline" style={{ width: "100%" }}>
          <Flex align="center" gap="2" justify="center">
            <PiPlus size={14} />
            <Text size="2">Add Series</Text>
          </Flex>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item onClick={() => onAdd("metric")}>
          <Flex align="center" gap="2">
            <PiChartBar size={14} />
            <Text>Metric</Text>
          </Flex>
        </DropdownMenu.Item>
        <DropdownMenu.Item onClick={() => onAdd("factTable")}>
          <Flex align="center" gap="2">
            <PiTable size={14} />
            <Text>Fact Table</Text>
          </Flex>
        </DropdownMenu.Item>
        <DropdownMenu.Item onClick={() => onAdd("sql")}>
          <Flex align="center" gap="2">
            <PiCode size={14} />
            <Text>SQL Query</Text>
          </Flex>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

export default function MetricExplorerSettings({
  block,
  setBlock,
  series,
  selectedSeriesId,
  onSelectSeries,
  onAddSeries,
  onUpdateSeries,
  onDeleteSeries,
}: Props) {
  const { getFactMetricById, getFactTableById } = useDefinitions();

  // Get the first series to populate global options (Group By, Global Filters)
  const firstSeries = series[0];
  let firstSeriesFactTable: FactTableInterface | null = null;
  if (firstSeries) {
    if (firstSeries.type === "metric") {
      const config = firstSeries.config as MetricSeriesConfig;
      if (config.factMetricId) {
        const m = getFactMetricById(config.factMetricId);
        firstSeriesFactTable = getFactTableById(
          m?.numerator?.factTableId || "",
        );
      }
    } else if (firstSeries.type === "factTable") {
      const config = firstSeries.config as FactTableSeriesConfig;
      if (config.factTableId) {
        firstSeriesFactTable = getFactTableById(config.factTableId);
      }
    }
  }

  return (
    <Flex direction="column" gap="3" mb="3">
      {/* Series Cards */}
      <Flex direction="column" gap="3">
        {series.map((s, index) => (
          <SeriesCard
            key={s.id}
            s={s}
            index={index}
            isOpen={s.id === selectedSeriesId}
            onToggle={() =>
              onSelectSeries(s.id === selectedSeriesId ? null : s.id)
            }
            onUpdate={(updates) => onUpdateSeries(s.id, updates)}
            onDelete={() => onDeleteSeries(s.id)}
            block={block}
            setBlock={setBlock}
          />
        ))}
      </Flex>

      {/* Add Series Button */}
      <AddSeriesButton onAdd={onAddSeries} />

      {/* Global Settings Section */}
      <Flex
        direction="column"
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
                    <PiGearSix
                      style={{ color: "var(--violet-11)" }}
                      size={20}
                    />
                    Analysis Options
                  </Flex>
                  <FaAngleRight className="chevron" />
                </Flex>
              </Text>
            </div>
          }
        >
          <Box p="3" height="fit-content">
            <Flex direction="column" gap="4">
              {/* Group By */}
              <MultiSelectField
                label="Group By"
                value={block.analysisSettings.groupBy || []}
                onChange={(v) =>
                  setBlock({
                    ...block,
                    visualizationType: v.length > 0 ? "bar" : "timeseries",
                    analysisSettings: {
                      ...block.analysisSettings,
                      groupBy: v.length > 0 ? v : undefined,
                    },
                  })
                }
                options={(() => {
                  if (!firstSeriesFactTable) return [];
                  return firstSeriesFactTable.columns.map((c) => ({
                    label: c.name || c.column,
                    value: c.column,
                  }));
                })()}
                placeholder="Select dimensions..."
                disabled={series.length === 0}
              />

              {/* Global Filters */}
              {firstSeriesFactTable && (
                <Box>
                  <Text size="2" weight="medium" mb="2">
                    Global Filters
                  </Text>
                  <RowFilterInput
                    value={block.globalRowFilters || []}
                    setValue={(filters: RowFilter[]) =>
                      setBlock({
                        ...block,
                        globalRowFilters: filters,
                      })
                    }
                    factTable={firstSeriesFactTable}
                  />
                </Box>
              )}
            </Flex>
          </Box>
        </Collapsible>
      </Flex>
    </Flex>
  );
}
