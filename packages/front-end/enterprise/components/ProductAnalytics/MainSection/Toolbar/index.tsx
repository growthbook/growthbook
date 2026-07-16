import { Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Switch from "@/ui/Switch";
import GraphTypeSelector from "./GraphTypeSelector";
import DateRangePicker, { ComparisonDateControls } from "./DateRangePicker";
import GranularitySelector from "./GranularitySelector";
import LastRefreshedIndicator from "./LastRefreshedIndicator";
import DataSourceDropdown from "./DataSourceDropdown";

export default function Toolbar() {
  const {
    exploration,
    draftExploreState,
    submittedExploreState,
    compareEnabled,
    setCompareEnabled,
    managedWarehouseUnavailable,
  } = useExplorerContext();

  const showComparisonDateControls =
    compareEnabled &&
    draftExploreState.dateRange.predefined === "customDateRange" &&
    Boolean(draftExploreState.dateRange.startDate) &&
    Boolean(draftExploreState.dateRange.endDate);

  return (
    <Flex direction="column" gap="3">
      {/* Top Toolbar */}
      <Flex justify="between" align="center" height="32px">
        {/* Left Side */}
        <Flex align="center" gap="3">
          <DataSourceDropdown />
        </Flex>

        {/* Right Side */}
        <Flex align="center" gap="3">
          <LastRefreshedIndicator
            lastRefreshedAt={
              exploration?.runStarted
                ? getValidDate(exploration.runStarted)
                : null
            }
          />
        </Flex>
      </Flex>

      {/* Bottom Toolbar */}
      <Flex align="start" gap="3" style={{ minHeight: "32px" }}>
        {/* Left Side */}
        <Flex align="center" gap="3" style={{ flexShrink: 0, height: "32px" }}>
          <GraphTypeSelector />
        </Flex>

        {/* Right Side — everything wraps and stays right-aligned as one row. */}
        <Flex
          align="center"
          justify="end"
          wrap="wrap"
          gap="3"
          style={{ flexGrow: 1, minWidth: 0 }}
        >
          <Switch
            label="Compare"
            value={compareEnabled}
            onChange={setCompareEnabled}
            disabled={!submittedExploreState || managedWarehouseUnavailable}
          />
          {showComparisonDateControls ? (
            <ComparisonDateControls
              groupBySlot={
                ["line", "area", "timeseries-table"].includes(
                  draftExploreState.chartType,
                ) ? (
                  <GranularitySelector />
                ) : null
              }
            />
          ) : (
            <>
              <DateRangePicker />
              {["line", "area", "timeseries-table"].includes(
                draftExploreState.chartType,
              ) && <GranularitySelector />}
            </>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}
