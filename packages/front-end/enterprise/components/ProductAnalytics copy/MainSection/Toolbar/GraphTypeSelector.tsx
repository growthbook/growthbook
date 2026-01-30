import React from "react";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "shared/enterprise";
import { FactMetricInterface } from "shared/types/fact-table";
import { Select, SelectItem } from "@/ui/Select";
import { useExplorerContext } from "../../ExplorerContext";

// interface Props {
//   block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
//   setBlock: React.Dispatch<
//     DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
//   >;
//   factMetric?: FactMetricInterface;
// }

export default function GraphTypeSelector() {
  const { draftExploreState, submittedExploreState, exploreData, loading, hasPendingChanges, setDraftExploreState } = useExplorerContext();

  return (
    <Select
      size="2"
      value={draftExploreState.visualizationType}
      placeholder="Select value"
      setValue={(v) =>
        setDraftExploreState((prev) => ({
          ...prev,
          visualizationType: v as "bigNumber" | "timeseries" | "bar",
        }))
      }
      containerClassName="mb-0"
    >
      <SelectItem value="bigNumber">Big Number</SelectItem>
      <SelectItem value="timeseries">Timeseries</SelectItem>
      <SelectItem value="bar">Bar Chart</SelectItem>
    </Select>
  );
}
