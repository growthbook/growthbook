import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useEffect, useState } from "react";
import { Flex, TextField, Text } from "@radix-ui/themes";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import PopulationChooser from "@/components/MetricAnalysis/PopulationChooser";
import MultiSelectField from "@/components/Forms/MultiSelectField";

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

  // TODO: reset invalid values when metric changes
  return (
    <Flex direction="column" gap="3" mb="3">
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

      {metric && factTable && factTable.filters?.length > 0 && (
        <MultiSelectField
          label={
            <Text as="label" size="3" weight="medium">
              Filters
            </Text>
          }
          value={block.filters ?? []}
          containerClassName="mb-0"
          labelClassName="mb-0"
          onChange={(filters) =>
            setBlock({
              ...block,
              filters,
            })
          }
          placeholder="Apply filters..."
          options={factTable.filters.map((f) => ({
            value: f.id,
            label: f.name,
          }))}
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
            {metric?.metricType === "proportion" ? "Proportion" : "Average"}
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
          isCustomLookback ? "-1" : block.analysisSettings.lookbackDays + ""
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
            visualizationType: v as "bigNumber" | "timeseries" | "histogram",
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
  );
}
