import React from "react";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "shared/enterprise";
import { Select, SelectItem } from "@/ui/Select";
import { useExplorerContext } from "../../ExplorerContext";
import { dateGranularity } from "shared/validators";

// interface Props {
//   block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
//   setBlock: React.Dispatch<
//     DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
//   >;
// }

const dateGranularityLabels: Record<typeof dateGranularity[number], string> = {
  auto: "Auto",
  hour: "Hourly",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};

export default function GranularitySelector() {
  const { draftExploreState, submittedExploreState, exploreData, loading, hasPendingChanges, setDraftExploreState } = useExplorerContext();
  
  const dateDimension = draftExploreState.dimensions.find((d) => d.dimensionType === "date");
  console.log("draftExploreState", draftExploreState);
  const granularity = dateDimension?.dateGranularity || "day";

  return (
    <Select
      size="2"
      value={granularity}
      placeholder="Granularity"
      setValue={(v) => {
        setDraftExploreState((prev) => ({
          ...prev,
          dimensions: prev.dimensions.map((d) => d.dimensionType === "date" ? { ...d, dateGranularity: v as "day" | "week" | "month" | "year" } : d),
        }));
      }}
      containerClassName="mb-0"
    >
      {dateGranularity.map((g) => (
        <SelectItem key={g} value={g}>
          {dateGranularityLabels[g]}
        </SelectItem>
      ))}
    </Select>
  );
}
