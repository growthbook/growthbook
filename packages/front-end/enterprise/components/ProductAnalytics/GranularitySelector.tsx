import React from "react";
import { Select, SelectItem } from "@/ui/Select";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "shared/enterprise";

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
}

export default function GranularitySelector({ block, setBlock }: Props) {
  const granularity = block.analysisSettings.granularity || "day";

  return (
    <Select
      size="2"
      value={granularity}
      placeholder="Granularity"
      setValue={(v) => {
        setBlock({
          ...block,
          analysisSettings: {
            ...block.analysisSettings,
            granularity: v as "day" | "week" | "month" | "year",
          },
        });
      }}
      containerClassName="mb-0"
    >
      <SelectItem value="day">Daily</SelectItem>
      <SelectItem value="week">Weekly</SelectItem>
      <SelectItem value="month">Monthly</SelectItem>
      <SelectItem value="year">Yearly</SelectItem>
    </Select>
  );
}
