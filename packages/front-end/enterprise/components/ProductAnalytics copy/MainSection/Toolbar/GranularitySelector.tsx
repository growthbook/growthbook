import React from "react";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "shared/enterprise";
import { Select, SelectItem } from "@/ui/Select";
import { useExplorerContext } from "../../ExplorerContext";

// interface Props {
//   block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
//   setBlock: React.Dispatch<
//     DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
//   >;
// }

export default function GranularitySelector() {
  const { draftExploreState, submittedExploreState, exploreData, loading, hasPendingChanges, setDraftExploreState } = useExplorerContext();
  const granularity = draftExploreState.granularity || "day";

  return (
    <Select
      size="2"
      value={granularity}
      placeholder="Granularity"
      setValue={(v) => {
        setDraftExploreState((prev) => ({
          ...prev,
          granularity: v as "day" | "week" | "month" | "year",
        }));
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
