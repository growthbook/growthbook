import { Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import Checkbox from "@/ui/Checkbox";
import Tooltip from "@/components/Tooltip/Tooltip";
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
    autoSubmitEnabled,
    setAutoSubmitEnabled,
  } = useExplorerContext();

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
          <Tooltip body="Automatically update the chart as you make changes.">
            <Checkbox
              label="Auto"
              value={autoSubmitEnabled}
              setValue={setAutoSubmitEnabled}
              size="sm"
            />
          </Tooltip>
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
          <GraphTypeSelector />
        </Flex>

        {/* Right Side */}
        <Flex align="center" gap="3">
          <DateRangePicker />
          {["line", "area", "timeseries-table"].includes(
            draftExploreState.chartType,
          ) && <GranularitySelector />}
        </Flex>
      </Flex>
    </Flex>
  );
}
