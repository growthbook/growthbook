import React from "react";
import { FactMetricInterface } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import { useExplorerContext } from "../../ExplorerContext";
import { chartTypes } from "shared/validators";

const chartTypeLabels: Record<typeof chartTypes[number], string> = {
  line: "Timeseries",
  bar: "Bar",
  bigNumber: "Big Number",
};
export default function GraphTypeSelector() {
  const { draftExploreState, submittedExploreState, exploreData, loading, hasPendingChanges, setDraftExploreState } = useExplorerContext();

  return (
    <Select
      size="2"
      value={draftExploreState.chartType}
      placeholder="Select value"
      setValue={(v) =>
        setDraftExploreState((prev) => ({
          ...prev,
          chartType: v as "line" | "bar" | "bigNumber",
        }))
      }
      containerClassName="mb-0"
    >
      {chartTypes.map((type) => (
        <SelectItem key={type} value={type}>
          {chartTypeLabels[type]}
        </SelectItem>
      ))}
    </Select>
  );
}
