import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import DateRangePicker from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DateRangePicker";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import LastRefreshedIndicator from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/LastRefreshedIndicator";
import { useUserJourneyContext } from "./UserJourneyContext";

export default function Toolbar() {
  const { draftUserJourneyState, setDraftUserJourneyState, userJourney } =
    useUserJourneyContext();

  return (
    <>
      <Flex direction="column" gap="3">
        {/* Top Toolbar */}
        <Flex justify="between" align="center" height="32px">
          {/* Left Side */}
          <Flex align="center" gap="3">
            <DataSourceDropdown
              value={draftUserJourneyState.datasource}
              setValue={(datasourceId) =>
                setDraftUserJourneyState((prev) => ({
                  ...prev,
                  datasource: datasourceId,
                  factTableId: "",
                }))
              }
              isSubmittable={false}
            />
          </Flex>

          {/* Right Side */}
          <Flex align="center" gap="3">
            <LastRefreshedIndicator
              lastRefreshedAt={
                userJourney?.runStarted
                  ? getValidDate(userJourney.runStarted)
                  : null
              }
            />
          </Flex>
        </Flex>

        {/* Bottom Toolbar */}
        <Flex justify="between" align="center" height="32px">
          {/* Left Side */}
          <Flex align="center" gap="3" />
          {/* Right Side */}
          <Flex align="center" gap="3">
            <DateRangePicker
              value={draftUserJourneyState.dateRange}
              setValue={(updater) =>
                setDraftUserJourneyState((prev) => ({
                  ...prev,
                  dateRange: updater(prev.dateRange),
                }))
              }
              showLookbackUnit={false}
            />
          </Flex>
        </Flex>
      </Flex>
    </>
  );
}
