import { Flex } from "@radix-ui/themes";
import { PiArrowsClockwise } from "react-icons/pi";
import { getValidDate } from "shared/dates";
import Button from "@/ui/Button";
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
    loading,
    handleSubmit,
    autoSubmitEnabled,
    setAutoSubmitEnabled,
    isStale,
    isSubmittable,
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
          <Checkbox
            label="Auto submit"
            value={autoSubmitEnabled}
            setValue={setAutoSubmitEnabled}
            size="sm"
          />
          <Tooltip
            body="Configuration has changed. Click to refresh the chart."
            shouldDisplay={isStale}
          >
            <Button
              size="sm"
              variant={autoSubmitEnabled ? "outline" : "solid"}
              disabled={
                loading ||
                !draftExploreState?.dataset?.values?.length ||
                !isSubmittable
              }
              onClick={handleSubmit}
            >
              <Flex align="center" gap="2">
                <PiArrowsClockwise />
                Update
                {isStale && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: "var(--amber-9)",
                      flexShrink: 0,
                    }}
                    aria-hidden
                  />
                )}
              </Flex>
            </Button>
          </Tooltip>
          <LastRefreshedIndicator
            lastRefreshedAt={getValidDate(exploration?.runStarted)}
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
          {["line", "area"].includes(draftExploreState.chartType) && (
            <GranularitySelector />
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}
