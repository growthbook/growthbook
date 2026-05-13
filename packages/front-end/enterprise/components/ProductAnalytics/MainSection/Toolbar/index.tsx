import { Flex, Box } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Switch from "@/ui/Switch";
import GraphTypeSelector from "./GraphTypeSelector";
import DateRangePicker from "./DateRangePicker";
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
    comparisonLoading,
    comparisonError,
    managedWarehouseAwaitingProvisioning,
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
        <Flex align="center" gap="3" wrap="wrap">
          <Flex align="center" gap="2" style={{ minWidth: 0 }}>
            <Switch
              label="Compare"
              value={compareEnabled}
              onChange={setCompareEnabled}
              disabled={
                !submittedExploreState || managedWarehouseAwaitingProvisioning
              }
            />
            {compareEnabled && submittedExploreState ? (
              <Flex align="center" gap="1" style={{ minWidth: 0 }}>
                {comparisonLoading ? (
                  <Box
                    as="span"
                    style={{
                      fontSize: "12px",
                      color: "var(--gray-11)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Loading previous period…
                  </Box>
                ) : null}
                {comparisonError ? (
                  <Box
                    as="span"
                    style={{
                      fontSize: "12px",
                      color: "var(--red-11)",
                      maxWidth: 220,
                    }}
                  >
                    {comparisonError}
                  </Box>
                ) : null}
              </Flex>
            ) : null}
          </Flex>
          <DateRangePicker />
          {["line", "area", "timeseries-table"].includes(
            draftExploreState.chartType,
          ) && <GranularitySelector />}
        </Flex>
      </Flex>
    </Flex>
  );
}
