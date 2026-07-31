import { Flex } from "@radix-ui/themes";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { isTimelessSqlExploration } from "@/enterprise/components/ProductAnalytics/util";
import Tooltip from "@/components/Tooltip/Tooltip";
import Switch from "@/ui/Switch";
import GraphTypeSelector from "./GraphTypeSelector";
import FunnelGraphTypeSelector from "./FunnelGraphTypeSelector";
import FunnelYAxisSelector from "./FunnelYAxisSelector";
import DateRangePicker, { ComparisonDateControls } from "./DateRangePicker";
import GranularitySelector from "./GranularitySelector";

export default function Toolbar() {
  const {
    draftExploreState,
    submittedExploreState,
    compareEnabled,
    setCompareEnabled,
    managedWarehouseUnavailable,
  } = useExplorerContext();
  const isFunnel = draftExploreState.dataset?.type === "funnel";
  const dateControlsDisabled = isTimelessSqlExploration(draftExploreState);

  const showComparisonDateControls =
    compareEnabled &&
    draftExploreState.dateRange.predefined === "customDateRange" &&
    Boolean(draftExploreState.dateRange.startDate) &&
    Boolean(draftExploreState.dateRange.endDate);

  return (
    <Flex align="start" gap="3" width="100%" style={{ minHeight: "32px" }}>
      {/* Left Side */}
      <Flex align="center" gap="3" style={{ flexShrink: 0, height: "32px" }}>
        {isFunnel ? <FunnelGraphTypeSelector /> : <GraphTypeSelector />}
        {isFunnel && draftExploreState.chartType !== "table" && (
          <FunnelYAxisSelector />
        )}
      </Flex>

      {/* Right Side — everything wraps and stays right-aligned as one row. */}
      <Flex
        align="center"
        justify="end"
        wrap="wrap"
        gap="3"
        style={{ flexGrow: 1, minWidth: 0 }}
      >
        <Tooltip
          body="Update your SQL query to return a date or timestamp column to compare date ranges."
          shouldDisplay={dateControlsDisabled}
          usePortal
          style={{ display: "inline-flex" }}
        >
          <Switch
            label="Compare"
            value={compareEnabled}
            onChange={setCompareEnabled}
            disabled={
              dateControlsDisabled ||
              !submittedExploreState ||
              managedWarehouseUnavailable
            }
          />
        </Tooltip>
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
            <Tooltip
              body="Update your SQL query to return a date or timestamp column to filter by date."
              shouldDisplay={dateControlsDisabled}
              usePortal
              style={{ display: "inline-flex" }}
            >
              <DateRangePicker disabled={dateControlsDisabled} />
            </Tooltip>
            {!isFunnel &&
              ["line", "area", "timeseries-table"].includes(
                draftExploreState.chartType,
              ) && <GranularitySelector />}
          </>
        )}
      </Flex>
    </Flex>
  );
}
