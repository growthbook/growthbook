import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiFunnel, PiTable } from "react-icons/pi";
import { Select, SelectItem, SelectGroup, SelectLabel } from "@/ui/Select";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

const FUNNEL_GRAPH_ITEMS: {
  value: "bar" | "table";
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { value: "bar", label: "Funnel", icon: PiFunnel },
  { value: "table", label: "Funnel Table", icon: PiTable },
];

/**
 * Two-option chart-type picker shown only for funnel explorations. We keep
 * the underlying `chartType` within the existing enum ("bar" / "table") so
 * downstream code that branches on chartType (e.g. chart vs. table panel
 * layout in ExplorerMainSection) keeps working without changes. The actual
 * funnel-vs-bar rendering switches on `dataset.type === "funnel"` inside
 * ExplorerChart / ExplorerDataTable, not on chartType.
 */
export default function FunnelGraphTypeSelector() {
  const { draftExploreState, changeChartType } = useExplorerContext();

  // Treat any non-"table" chartType as the funnel chart view so we don't
  // strand a previously-saved chartType like "line" on a stale config.
  const activeValue: "bar" | "table" =
    draftExploreState.chartType === "table" ? "table" : "bar";

  return (
    <Select
      size="small"
      value={activeValue}
      placeholder="Select view"
      setValue={(v) => changeChartType(v as "bar" | "table")}
    >
      <SelectGroup>
        <SelectLabel>View</SelectLabel>
        {FUNNEL_GRAPH_ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <Flex align="center" gap="2">
              <item.icon size={15} /> {item.label}
            </Flex>
          </SelectItem>
        ))}
      </SelectGroup>
    </Select>
  );
}
