import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useEffect, useState } from "react";
import { Flex, TextField, Text, Box } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiSlidersHorizontal, PiWrench } from "react-icons/pi";
import { FaAngleRight } from "react-icons/fa";
import { FactTableInterface } from "back-end/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import PopulationChooser from "@/components/MetricAnalysis/PopulationChooser";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricSlicesSection from "./MetricSlicesSection";
import MetricExplorerDisplaySettings from "./MetricExplorerDisplaySettings";

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
}
export default function MetricExplorerSettings({ block, setBlock }: Props) {
  const { getFactMetricById, getFactTableById } = useDefinitions();
  const metric = getFactMetricById(block.factMetricId);
  const factTable = getFactTableById(metric?.numerator?.factTableId || "");
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

  // Preset values that appear in the dropdown
  const presetDays = [7, 14, 30, 90, 180, 365];

  // Track whether user selected "Custom Lookback" option
  // Initialize based on whether current value is a preset or custom
  const [isCustomLookback, setIsCustomLookback] = useState(() => {
    return !presetDays.includes(block.analysisSettings.lookbackDays);
  });

  // Local state for custom lookback input to allow empty values while typing
  // Initialize with current value if it's custom
  const [customDaysInput, setCustomDaysInput] = useState(() => {
    return !presetDays.includes(block.analysisSettings.lookbackDays)
      ? block.analysisSettings.lookbackDays.toString()
      : "";
  });

  useEffect(() => {
    // If there is only one userId type for a Fact Table and no userId type is selected, auto-select for the user
    if (
      factTable?.userIdTypes?.length === 1 &&
      block.analysisSettings.userIdType === ""
    ) {
      setBlock({
        ...block,
        analysisSettings: {
          ...block.analysisSettings,
          userIdType: factTable.userIdTypes[0],
        },
      });
    }
  }, [block, factTable?.userIdTypes, setBlock]);

  return (
    <Flex direction="column" gap="3" mb="3">
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
                    <PiWrench style={{ color: "var(--violet-11)" }} size={20} />
                    Configuration
                  </Flex>
                  <FaAngleRight className="chevron" />
                </Flex>
              </Text>
            </div>
          }
        >
          <Box p="4" height="fit-content">
            <Flex direction="column" gap="4">
              {metric && factTable && (
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
              )}

              {metric && factTable && (
                <PopulationChooser
                  datasourceId={factTable.datasource}
                  value={block.analysisSettings.populationType ?? "factTable"}
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
              )}

              {metric && metric?.metricType !== "ratio" && (
                <Select
                  label="Metric Value"
                  size="2"
                  value={block.valueType}
                  placeholder="Select value"
                  setValue={(v) =>
                    setBlock({ ...block, valueType: v as "sum" | "avg" })
                  }
                >
                  <SelectItem value="avg">
                    {metric?.metricType === "proportion"
                      ? "Proportion"
                      : "Average"}
                  </SelectItem>
                  <SelectItem value="sum">
                    {metric?.metricType === "proportion" ? "Unit Count" : "Sum"}
                  </SelectItem>
                </Select>
              )}
              <Select
                label="Date Range"
                size="2"
                value={
                  isCustomLookback
                    ? "-1"
                    : block.analysisSettings.lookbackDays + ""
                }
                placeholder="Select value"
                setValue={(v) => {
                  const days = parseInt(v);

                  if (days === -1) {
                    // User selected "Custom Lookback"
                    setIsCustomLookback(true);
                    // Set a default value to start with
                    setCustomDaysInput("60");
                    const start = new Date();
                    const end = new Date();
                    start.setDate(end.getDate() - 60);

                    setBlock({
                      ...block,
                      analysisSettings: {
                        ...block.analysisSettings,
                        lookbackDays: 60,
                        startDate: start,
                        endDate: end,
                      },
                    });
                  } else {
                    // User selected a preset value
                    setIsCustomLookback(false);
                    const start = new Date();
                    const end = new Date();
                    start.setDate(end.getDate() - days);

                    setBlock({
                      ...block,
                      analysisSettings: {
                        ...block.analysisSettings,
                        lookbackDays: days,
                        startDate: start,
                        endDate: end,
                      },
                    });
                  }
                }}
              >
                {presetDays.map((days) => (
                  <SelectItem key={days} value={days.toString()}>
                    Last {days} Days
                  </SelectItem>
                ))}
                <SelectItem value="-1">Custom Lookback</SelectItem>
              </Select>

              {isCustomLookback && (
                <TextField.Root
                  size="2"
                  type="number"
                  min="1"
                  placeholder="Enter number of days"
                  value={customDaysInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCustomDaysInput(value); // Always update local state for typing
                    const days = parseInt(value);
                    // Update block state when we have a valid positive number
                    if (days > 0 && !isNaN(days)) {
                      const start = new Date();
                      const end = new Date();
                      start.setDate(end.getDate() - days);

                      setBlock({
                        ...block,
                        analysisSettings: {
                          ...block.analysisSettings,
                          lookbackDays: days,
                          startDate: start,
                          endDate: end,
                        },
                      });
                    }
                  }}
                />
              )}

              <Select
                label="Graph Type"
                size="2"
                value={block.visualizationType}
                placeholder="Select value"
                setValue={(v) =>
                  setBlock({
                    ...block,
                    visualizationType: v as
                      | "bigNumber"
                      | "timeseries"
                      | "histogram",
                  })
                }
              >
                <SelectItem value="bigNumber">Big Number</SelectItem>
                <SelectItem value="timeseries">Timeseries</SelectItem>
                {metric?.metricType === "mean" && (
                  <SelectItem value="histogram">Histogram</SelectItem>
                )}
              </Select>
            </Flex>
          </Box>
        </Collapsible>
      </Flex>
      <MetricSlicesSection
        block={block}
        setBlock={setBlock}
        factTable={factTable}
      />
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
                    <PiSlidersHorizontal
                      style={{
                        color: "var(--violet-11)",
                      }}
                      size={20}
                    />
                    Filters
                    <Badge
                      label={
                        (
                          (block.analysisSettings.additionalNumeratorFilters
                            ?.length || 0) +
                          (block.analysisSettings.additionalDenominatorFilters
                            ?.length || 0)
                        ).toString() || "0"
                      }
                      color="violet"
                      radius="full"
                      variant="soft"
                    />
                  </Flex>
                  <Flex align="center" gap="1">
                    <Button
                      variant="ghost"
                      color="red"
                      disabled={
                        block.analysisSettings.additionalNumeratorFilters
                          ?.length === 0 &&
                        block.analysisSettings.additionalDenominatorFilters
                          ?.length === 0
                      }
                      onClick={() => {
                        setBlock({
                          ...block,
                          analysisSettings: {
                            ...block.analysisSettings,
                            additionalNumeratorFilters: [],
                            additionalDenominatorFilters: [],
                          },
                        });
                      }}
                    >
                      Clear
                    </Button>
                    <FaAngleRight className="chevron" />
                  </Flex>
                </Flex>
              </Text>
            </div>
          }
          transitionTime={100}
        >
          <Box p="4" height="fit-content">
            <Flex direction="column" gap="4">
              <MultiSelectField
                label={
                  <Flex align="center" gap="1">
                    <Text as="label" size="3" weight="medium">
                      Row Filters
                    </Text>
                    {metric?.denominator?.factTableId ? (
                      <Text as="span" size="2" mb="2">
                        {" "}
                        (Numerator)
                      </Text>
                    ) : null}
                    <Tooltip
                      body={`Row Filters specified here are combined with any existing filters on the metric ${metric?.denominator?.factTableId ? "numerator" : ""}.`}
                      className="mb-2"
                    />
                  </Flex>
                }
                value={block.analysisSettings.additionalNumeratorFilters ?? []}
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
                      <Text as="label" size="3" weight="medium">
                        Row Filters
                      </Text>

                      <Text as="span" size="2" mb="2">
                        {" "}
                        (Denominator)
                      </Text>
                      <Tooltip
                        body="Row Filters specified here are combined with any existing denominator filters defined on the metric."
                        className="mb-2"
                      />
                    </Flex>
                  }
                  value={
                    block.analysisSettings.additionalDenominatorFilters ?? []
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
                  placeholder="Apply additionalfilters..."
                  options={
                    denominatorFactTable?.filters?.map((f) => ({
                      value: f.id,
                      label: f.name,
                    })) || []
                  }
                />
              ) : null}
            </Flex>
          </Box>
        </Collapsible>
      </Flex>
      <MetricExplorerDisplaySettings
        block={block}
        setBlock={setBlock}
        factTable={factTable}
      />
    </Flex>
  );
}
