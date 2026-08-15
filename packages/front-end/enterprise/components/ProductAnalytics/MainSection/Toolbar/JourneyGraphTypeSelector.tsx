import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiShareNetwork, PiTable, PiWarningBold } from "react-icons/pi";
import { Select, SelectItem, SelectGroup, SelectLabel } from "@/ui/Select";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { journeyPreferredView } from "@/enterprise/components/ProductAnalytics/util";

const JOURNEY_GRAPH_ITEMS: {
  value: "bar" | "table";
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { value: "bar", label: "Visualization", icon: PiShareNetwork },
  { value: "table", label: "Results / SQL", icon: PiTable },
];

/**
 * Two-option chart-type picker shown only for journey explorations. We keep
 * the underlying `chartType` within the existing enum ("bar" / "table") so
 * downstream layout that branches on chartType keeps working. Sankey vs table
 * rendering switches on `dataset.type === "journey"` inside ExplorerChart.
 */
export default function JourneyGraphTypeSelector() {
  const { draftExploreState, changeChartType, exploration, error, loading } =
    useExplorerContext();

  const hasData = (exploration?.result?.rows?.length ?? 0) > 0;
  const hasError = !!error && !loading;
  const showQueryError = hasData && hasError;
  const activeValue = journeyPreferredView({
    chartType: draftExploreState.chartType,
    hasData,
    hasError,
  });

  return (
    <Flex align="center" gap="2">
      <Select
        size="md"
        value={activeValue}
        placeholder="Select view"
        disabled={!hasData}
        setValue={(v) => changeChartType(v as "bar" | "table")}
      >
        <SelectGroup>
          <SelectLabel>View</SelectLabel>
          {JOURNEY_GRAPH_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <Flex align="center" gap="2">
                <item.icon size={15} /> {item.label}
                {item.value === "table" && showQueryError ? (
                  <PiWarningBold
                    size={14}
                    style={{ color: "var(--red-9)" }}
                    aria-label="Query error"
                  />
                ) : null}
              </Flex>
            </SelectItem>
          ))}
        </SelectGroup>
      </Select>
      {showQueryError ? (
        <PiWarningBold
          size={16}
          style={{ color: "var(--red-9)", flexShrink: 0 }}
          aria-label="Query error"
        />
      ) : null}
    </Flex>
  );
}
