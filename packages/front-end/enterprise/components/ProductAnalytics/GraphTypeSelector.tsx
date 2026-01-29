import React from "react";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "shared/enterprise";
import { FactMetricInterface } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
  factMetric?: FactMetricInterface;
}

export default function GraphTypeSelector({
  block,
  setBlock,
  factMetric,
}: Props) {
  return (
    <Select
      size="2"
      value={block.visualizationType}
      placeholder="Select value"
      setValue={(v) =>
        setBlock({
          ...block,
          visualizationType: v as "bigNumber" | "timeseries" | "histogram",
        })
      }
      containerClassName="mb-0"
    >
      <SelectItem value="bigNumber">Big Number</SelectItem>
      <SelectItem value="timeseries">Timeseries</SelectItem>
      <SelectItem value="bar">Bar Chart</SelectItem>
      {factMetric?.metricType === "mean" && (
        <SelectItem value="histogram">Histogram</SelectItem>
      )}
    </Select>
  );
}
