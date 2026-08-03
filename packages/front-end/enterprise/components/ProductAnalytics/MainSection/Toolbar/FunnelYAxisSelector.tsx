import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiHash, PiPercent } from "react-icons/pi";
import {
  ExplorationConfig,
  FunnelDataset,
  FunnelYAxisScale,
} from "shared/validators";
import { Select, SelectItem, SelectGroup, SelectLabel } from "@/ui/Select";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

const Y_AXIS_ITEMS: {
  value: FunnelYAxisScale;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { value: "percent", label: "Percent", icon: PiPercent },
  { value: "count", label: "Unit Count", icon: PiHash },
];

/**
 * Toggles the funnel bar chart's y-axis between raw user counts and
 * per-series percentages (step 1 = 100%). Saved on the funnel dataset so
 * the choice is preserved on URL share / dashboard saves.
 */
export default function FunnelYAxisSelector() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  if (draftExploreState.dataset?.type !== "funnel") return null;

  // Default to "percent" — matches the read-site fallback in FunnelChart.
  const activeValue: FunnelYAxisScale =
    draftExploreState.dataset.yAxisScale ?? "percent";

  const setScale = (next: FunnelYAxisScale) => {
    setDraftExploreState((prev) => {
      if (prev.dataset?.type !== "funnel") return prev;
      return {
        ...prev,
        dataset: { ...prev.dataset, yAxisScale: next } as FunnelDataset,
      } as ExplorationConfig;
    });
  };

  return (
    <Select
      size="small"
      value={activeValue}
      placeholder="Select y-axis"
      setValue={(v) => setScale(v as FunnelYAxisScale)}
    >
      <SelectGroup>
        <SelectLabel>Y-Axis</SelectLabel>
        {Y_AXIS_ITEMS.map((item) => (
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
