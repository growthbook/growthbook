import React from "react";
import { Flex } from "@radix-ui/themes";
import { chartTypes as chartTypeValues } from "shared/validators";
import {
  PiChartBar,
  PiChartBarHorizontal,
  PiChartLine,
  PiHash,
  PiTable,
} from "react-icons/pi";
import {
  Select,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "@/ui/Select";
import { AreaChartIcon } from "@/components/Icons";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

const chartTypes: {
  groupLabel: string;
  items: {
    value: (typeof chartTypeValues)[number];
    label: string;
    icon: React.ComponentType<{ size?: number }>;
  }[];
}[] = [
  {
    groupLabel: "Time Series",
    items: [
      { value: "line", label: "Line", icon: PiChartLine },
      { value: "area", label: "Area", icon: AreaChartIcon },
      { value: "timeseries-table", label: "Table", icon: PiTable },
    ],
  },
  {
    groupLabel: "Cumulative",
    items: [
      { value: "table", label: "Table", icon: PiTable },
      { value: "bar", label: "Bar", icon: PiChartBar },
      {
        value: "horizontalBar",
        label: "Horizontal Bar",
        icon: PiChartBarHorizontal,
      },
      { value: "bigNumber", label: "Big Number", icon: PiHash },
    ],
  },
];

export default function GraphTypeSelector() {
  const { draftExploreState, changeChartType } = useExplorerContext();

  return (
    <Select
      size="2"
      value={draftExploreState.chartType}
      placeholder="Select value"
      setValue={(v) => changeChartType(v as (typeof chartTypeValues)[number])}
    >
      {chartTypes.map((group, groupIndex) => (
        <div key={group.groupLabel}>
          {groupIndex > 0 && <SelectSeparator />}
          <SelectGroup>
            <SelectLabel>{group.groupLabel}</SelectLabel>
            {group.items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <Flex align="center" gap="2">
                  <item.icon size={15} /> {item.label}
                </Flex>
              </SelectItem>
            ))}
          </SelectGroup>
        </div>
      ))}
    </Select>
  );
}
