import { Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import GraphTypeSelector from "./GraphTypeSelector";
import DateRangePicker from "./DateRangePicker";
import GranularitySelector from "./GranularitySelector";
import LastRefreshedIndicator from "./LastRefreshedIndicator";
import DataSourceDropdown from "./DataSourceDropdown";

export default function Toolbar() {
  const {
    exploration,
    draftExploreState,
    setDraftExploreState,
    clearAllDatasets,
    handleSubmit,
    loading,
    isSubmittable,
  } = useExplorerContext();

  return (
    <Flex direction="column" gap="3">
      {/* Top Toolbar */}
      <Flex justify="between" align="center" height="32px">
        {/* Left Side */}
        <Flex align="center" gap="3">
          <DataSourceDropdown
            value={draftExploreState.datasource}
            setValue={clearAllDatasets}
            isSubmittable={isSubmittable}
          />
        </Flex>

        {/* Right Side */}
        <Flex align="center" gap="3">
          <LastRefreshedIndicator
            lastRefreshedAt={
              exploration?.runStarted
                ? getValidDate(exploration.runStarted)
                : null
            }
            onUpdate={() => handleSubmit({ force: true })}
            isUpdateDisabled={
              loading ||
              !draftExploreState?.dataset?.values?.length ||
              !isSubmittable
            }
          />
        </Flex>
      </Flex>

      {/* Bottom Toolbar */}
      <Flex justify="between" align="center" height="32px">
        {/* Left Side */}
        <Flex align="center" gap="3">
          <GraphTypeSelector />
        </Flex>

        {/* Right Side */}
        <Flex align="center" gap="3">
          <DateRangePicker
            value={draftExploreState.dateRange}
            setValue={(updater) =>
              setDraftExploreState((prev) => {
                const next = updater(prev.dateRange);
                return {
                  ...prev,
                  dateRange: {
                    ...next,
                    lookbackUnit: next.lookbackUnit ?? null,
                  },
                };
              })
            }
            showLookbackUnit
          />
          {["line", "area", "timeseries-table"].includes(
            draftExploreState.chartType,
          ) && <GranularitySelector />}
        </Flex>
      </Flex>
    </Flex>
  );
}
