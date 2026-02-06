import React from "react";
import { Select, SelectItem } from "@/ui/Select";
import { useExplorerContext } from "../../ExplorerContext";
import { chartTypes } from "shared/validators";

const chartTypeLabels: Record<typeof chartTypes[number], string> = {
  line: "Timeseries",
  bar: "Bar",
  bigNumber: "Big Number",
};
export default function GraphTypeSelector() {
  const { draftExploreState, changeChartType } = useExplorerContext();

  return (
    <Select
      size="2"
      value={draftExploreState.chartType}
      placeholder="Select value"
      setValue={(v) => changeChartType(v as "line" | "bar" | "bigNumber")}
    >
      {chartTypes.map((type) => (
        <SelectItem key={type} value={type}>
          {chartTypeLabels[type]}
        </SelectItem>
      ))}
    </Select>
  );
}
