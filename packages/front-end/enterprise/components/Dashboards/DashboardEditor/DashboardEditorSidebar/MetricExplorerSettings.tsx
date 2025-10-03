import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import React from "react";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import PopulationChooser from "@/components/MetricAnalysis/PopulationChooser";

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
}
export default function MetricExplorerSettings({ block, setBlock }: Props) {
  const { getFactMetricById, getFactTableById } = useDefinitions();
  const metric = getFactMetricById(block.metricId);
  const factTable = getFactTableById(metric?.numerator?.factTableId || "");

  // TODO: reset invalid values when metric changes
  return (
    <>
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
        value={block.analysisSettings.lookbackDays + ""}
        placeholder="Select value"
        setValue={(v) => {
          const days = parseInt(v);

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
        }}
      >
        <SelectItem value="7">Last 7 Days</SelectItem>
        <SelectItem value="14">Last 14 Days</SelectItem>
        <SelectItem value="30">Last 30 Days</SelectItem>
        <SelectItem value="90">Last 90 Days</SelectItem>
        <SelectItem value="180">Last 180 Days</SelectItem>
        <SelectItem value="365">Last 365 Days</SelectItem>
        <SelectItem value="9999">Last 9999 Days</SelectItem>
      </Select>

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
        {/* TODO: plumb metric type */}
        {/* {metric?.metricType === "mean" && (
          <SelectItem value="histogram">Histogram</SelectItem>
        )} */}
      </Select>
    </>
  );
}
