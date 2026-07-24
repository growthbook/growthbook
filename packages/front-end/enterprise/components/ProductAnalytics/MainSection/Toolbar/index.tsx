import { Flex } from "@radix-ui/themes";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
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
