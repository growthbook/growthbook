import { Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import {
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import type { DateRangeCompareValue } from "@/enterprise/components/ProductAnalytics/DateRangeComparePanel";
import GraphTypeSelector from "./GraphTypeSelector";
import FunnelGraphTypeSelector from "./FunnelGraphTypeSelector";
import FunnelYAxisSelector from "./FunnelYAxisSelector";
import LastRefreshedIndicator from "./LastRefreshedIndicator";
import DataSourceDropdown from "./DataSourceDropdown";

export default function Toolbar() {
  const {
    exploration,
    draftExploreState,
    setDraftExploreState,
    compareEnabled,
    comparisonMode,
    managedWarehouseUnavailable,
  } = useExplorerContext();
  const isFunnel = draftExploreState.dataset?.type === "funnel";
  // Bucketing only applies to a date dimension, so a chart without one has no
  // granularity to show.
  const showGranularity =
    !isFunnel &&
    ["line", "area", "timeseries-table"].includes(draftExploreState.chartType);

  const dateRangeValue: DateRangeCompareValue = {
    dateRange: draftExploreState.dateRange,
    comparison: compareEnabled
      ? {
          enabled: true,
          mode: comparisonMode,
          previousTimeFrame: draftExploreState.previousTimeFrame,
        }
      : null,
    granularity:
      draftExploreState.dimensions.find((d) => d.dimensionType === "date")
        ?.dateGranularity ?? "auto",
  };

  const applyDateRange = ({
    dateRange,
    comparison,
    granularity,
  }: DateRangeCompareValue) => {
    setDraftExploreState((prev) => {
      const next = {
        ...prev,
        dateRange,
        ...(granularity
          ? {
              dimensions: prev.dimensions.map((d) =>
                d.dimensionType === "date"
                  ? { ...d, dateGranularity: granularity }
                  : d,
              ),
            }
          : {}),
      };
      if (!comparison?.enabled) {
        const {
          previousTimeFrame: _,
          comparisonMode: __,
          ...withoutCompare
        } = next;
        return withoutCompare;
      }
      const mode = resolveComparisonMode(comparison);
      return {
        ...next,
        comparisonMode: mode,
        previousTimeFrame: resolveComparisonPreviousTimeFrame(
          dateRange,
          comparison,
        ),
      };
    });
  };

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
          <DateRangeCompareDropdown
            showCompare
            showGranularity={showGranularity}
            value={dateRangeValue}
            onChange={applyDateRange}
            disabled={managedWarehouseUnavailable}
          />
        </Flex>
      </Flex>
    </Flex>
  );
}
