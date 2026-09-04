import { Flex } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import {
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { isTimelessSqlExploration } from "@/enterprise/components/ProductAnalytics/util";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import type { DateRangeCompareValue } from "@/enterprise/components/ProductAnalytics/DateRangeComparePanel";
import { useOptionalSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import GraphTypeSelector from "./GraphTypeSelector";
import FunnelGraphTypeSelector from "./FunnelGraphTypeSelector";
import FunnelYAxisSelector from "./FunnelYAxisSelector";

export default function Toolbar() {
  const {
    draftExploreState,
    setDraftExploreState,
    compareEnabled,
    comparisonMode,
    managedWarehouseUnavailable,
  } = useExplorerContext();
  const isFunnel = draftExploreState.dataset?.type === "funnel";
  const viewMode = useOptionalSqlEditorContext()?.viewMode ?? "explore";
  const dateControlsDisabled = isTimelessSqlExploration(draftExploreState);
  const [dateTooltipArmed, setDateTooltipArmed] = useState(false);

  // Explore stays mounted as `display: none` on the Build tab. Showing it
  // fires a synthetic mouseenter if the cursor is already over the date
  // control, and a leftover Tooltip `open` would portal into the top-right.
  // Ignore hover until the pointer actually moves after the tab switch.
  useEffect(() => {
    if (viewMode === "dataset") {
      setDateTooltipArmed(false);
      return;
    }
    setDateTooltipArmed(false);
    const switchedAt = Date.now();
    const arm = () => {
      // The click that selected Explore Dataset itself generates pointermove.
      if (Date.now() - switchedAt < 150) return;
      setDateTooltipArmed(true);
      window.removeEventListener("pointermove", arm);
    };
    window.addEventListener("pointermove", arm);
    return () => window.removeEventListener("pointermove", arm);
  }, [viewMode]);
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

  const dateRangeDropdown = (
    <DateRangeCompareDropdown
      showCompare
      showGranularity={showGranularity}
      value={dateRangeValue}
      onChange={applyDateRange}
      disabled={dateControlsDisabled || managedWarehouseUnavailable}
    />
  );

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
        {dateControlsDisabled && viewMode !== "dataset" ? (
          <Tooltip
            body="Update your SQL query to return a date or timestamp column to compare date ranges."
            shouldDisplay={dateTooltipArmed}
            ignoreMouseEvents={!dateTooltipArmed}
            usePortal
            style={{ display: "inline-flex" }}
          >
            {dateRangeDropdown}
          </Tooltip>
        ) : (
          dateRangeDropdown
        )}
      </Flex>
    </Flex>
  );
}
