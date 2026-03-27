import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import toNumber from "lodash/toNumber";
import Text from "@/ui/Text";
import DateRangePicker from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DateRangePicker";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import LastRefreshedIndicator from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/LastRefreshedIndicator";
import SelectField from "@/components/Forms/SelectField";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
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
            {/* <Text>Number of Events Per Step</Text>
            <SelectField
              value={draftUserJourneyState.numOfEventsPerStep.toString()}
              containerStyles={{
                control: (base) => ({
                  ...base,
                  minHeight: 32,
                  height: 32,
                }),
                valueContainer: (base) => ({
                  ...base,
                  height: 32,
                  padding: "0 8px",
                }),
                indicatorsContainer: (base) => ({
                  ...base,
                  height: 32,
                }),
                input: (base) => ({
                  ...base,
                  margin: 0,
                  padding: 0,
                }),
              }}
              style={{ width: "50px" }}
              onChange={(value) =>
                setDraftUserJourneyState((prev) => ({
                  ...prev,
                  numOfEventsPerStep: toNumber(value),
                }))
              }
              options={[
                { label: "1", value: "1" },
                { label: "2", value: "2" },
                { label: "3", value: "3" },
                { label: "4", value: "4" },
                { label: "5", value: "5" },
                { label: "6", value: "6" },
                { label: "7", value: "7" },
                { label: "8", value: "8" },
                { label: "9", value: "9" },
                { label: "10", value: "10" },
              ]}
            /> */}
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
