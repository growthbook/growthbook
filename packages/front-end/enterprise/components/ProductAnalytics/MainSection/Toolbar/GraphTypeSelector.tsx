import React from "react";
import { Flex } from "@radix-ui/themes";
import { chartTypes as chartTypeValues } from "shared/validators";
import {
  PiChartBar,
  PiChartBarDuotone,
  PiChartBarHorizontal,
  PiChartBarHorizontalDuotone,
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
import Tooltip from "@/components/Tooltip/Tooltip";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  isTimelessSqlExploration,
  isTimeSeriesChart,
} from "@/enterprise/components/ProductAnalytics/util";

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
      { value: "bar", label: "Bar", icon: PiChartBar },
      { value: "stackedBar", label: "Bar (Stacked)", icon: PiChartBarDuotone },
      {
        value: "horizontalBar",
        label: "Horizontal Bar",
        icon: PiChartBarHorizontal,
      },
      {
        value: "stackedHorizontalBar",
        label: "Horizontal Bar (Stacked)",
        icon: PiChartBarHorizontalDuotone,
      },
      { value: "table", label: "Table", icon: PiTable },
      { value: "bigNumber", label: "Big Numbers", icon: PiHash },
    ],
  },
  {
    groupLabel: "Results",
    items: [{ value: "rawTable", label: "Raw table", icon: PiTable }],
  },
];

export default function GraphTypeSelector() {
  const { draftExploreState, changeChartType } = useExplorerContext();
  const timelessSql = isTimelessSqlExploration(draftExploreState);
  const groups =
    draftExploreState.dataset.type === "sql"
      ? chartTypes
      : chartTypes.filter((group) => group.groupLabel !== "Results");

  return (
    <Select
      size="md"
      value={draftExploreState.chartType}
      placeholder="Select value"
      setValue={(v) => changeChartType(v as (typeof chartTypeValues)[number])}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.groupLabel}>
          {groupIndex > 0 && <SelectSeparator />}
          <SelectGroup>
            <SelectLabel>{group.groupLabel}</SelectLabel>
            {group.items.map((item) => {
              const disabled = timelessSql && isTimeSeriesChart(item.value);
              const selectItem = (
                <SelectItem value={item.value} disabled={disabled}>
                  <Flex align="center" gap="2">
                    <item.icon size={15} /> {item.label}
                  </Flex>
                </SelectItem>
              );

              return disabled ? (
                <Tooltip
                  key={item.value}
                  body="Update your SQL query to return a date or timestamp column to use time-series charts."
                >
                  {selectItem}
                </Tooltip>
              ) : (
                <React.Fragment key={item.value}>{selectItem}</React.Fragment>
              );
            })}
          </SelectGroup>
        </div>
      ))}
    </Select>
  );
}
