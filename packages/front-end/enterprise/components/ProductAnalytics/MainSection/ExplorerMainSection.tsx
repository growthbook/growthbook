import { Flex } from "@radix-ui/themes";
import { PiArrowsClockwise } from "react-icons/pi";
import { BsGraphUpArrow } from "react-icons/bs";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import GraphTypeSelector from "./Toolbar/GraphTypeSelector";
import DateRangePicker from "./Toolbar/DateRangePicker";
import GranularitySelector from "./Toolbar/GranularitySelector";
import LastRefreshedIndicator from "./Toolbar/LastRefreshedIndicator";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";

export default function ExplorerMainSection() {
  const {
    exploreData,
    exploreError,
    draftExploreState,
    submittedExploreState,
    loading,
    lastRefreshedAt,
    handleSubmit,
    autoSubmitEnabled,
    setAutoSubmitEnabled,
    isStale,
    isSubmittable,
  } = useExplorerContext();

  return (
    <Flex direction="column" px="2" py="3" gap="4">
      <Flex justify="between" align="center" height="32px">
        <Flex align="center" gap="3">
          <GraphTypeSelector />
        </Flex>
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
          <DateRangePicker />
          {["line", "area"].includes(draftExploreState.chartType) && (
            <GranularitySelector />
          )}
          <LastRefreshedIndicator lastRefreshedAt={lastRefreshedAt} />
        </Flex>
      </Flex>

      {submittedExploreState?.dataset?.values?.length &&
      submittedExploreState?.dataset?.values?.length > 0 ? (
        <Flex direction="column" gap="3">
          <ExplorerChart
            exploreData={exploreData}
            submittedExploreState={submittedExploreState}
            loading={loading}
            exploreError={exploreError}
          />
          <ExplorerDataTable />
        </Flex>
      ) : (
        <Flex
          align="center"
          justify="center"
          direction="column"
          gap="3"
          style={{
            minHeight: "400px",
            color: "var(--color-text-mid)",
            border: "2px dashed var(--gray-a3)",
            borderRadius: "var(--radius-4)",
          }}
        >
          <BsGraphUpArrow size={48} className="text-muted" />
          <Text size="large" weight="medium">
            Configure your explorer to visualize data
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
