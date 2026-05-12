import { Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import GraphTypeSelector from "./GraphTypeSelector";
import FunnelGraphTypeSelector from "./FunnelGraphTypeSelector";
import DateRangePicker from "./DateRangePicker";
import GranularitySelector from "./GranularitySelector";
import LastRefreshedIndicator from "./LastRefreshedIndicator";
import DataSourceDropdown from "./DataSourceDropdown";

export default function Toolbar() {
  const { exploration, draftExploreState } = useExplorerContext();
  const isFunnel = draftExploreState.dataset?.type === "funnel";

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
      <Flex justify="between" align="center" height="32px">
        {/* Left Side */}
        <Flex align="center" gap="3">
          {isFunnel ? <FunnelGraphTypeSelector /> : <GraphTypeSelector />}
        </Flex>

        {/* Right Side */}
        <Flex align="center" gap="3">
          <DateRangePicker />
          {!isFunnel &&
            ["line", "area", "timeseries-table"].includes(
              draftExploreState.chartType,
            ) && <GranularitySelector />}
        </Flex>
      </Flex>
    </Flex>
  );
}
