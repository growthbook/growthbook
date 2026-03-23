import { Flex } from "@radix-ui/themes";
import toNumber from "lodash/toNumber";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";
import { useUserJourneyContext } from "./UserJourneyContext";

export default function AdditionalOptionsSection() {
  const { draftUserJourneyState, setDraftUserJourneyState } =
    useUserJourneyContext();

  return (
    <Flex
      width="100%"
      direction="column"
      p="3"
      gap="2"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Text weight="medium">
        <Flex align="center" gap="1">
          Measured As
          <Tooltip body="Determine whether to count total events or unique events per id type"></Tooltip>
        </Flex>
      </Text>

      <ButtonSelectField
        className="w-100"
        value={draftUserJourneyState.measurementType}
        setValue={(value: "total" | "unique") => {
          setDraftUserJourneyState((prev) => ({
            ...prev,
            measurementType: value,
          }));
        }}
        options={[
          { label: "Totals", value: "total" },
          { label: "Uniques", value: "unique" },
        ]}
      />

      <Flex align="center" gap="2" wrap="wrap">
        {/* MKTODO: Need to add validation here so a user can select more than 1 day*/}
        <Text weight="medium">Completed within</Text>
        <Field
          value={draftUserJourneyState.conversionWindow.value}
          type="number"
          min={1}
          style={{ width: 50 }}
          onChange={(e) => {
            const nextValue = parseInt(e.target.value);
            setDraftUserJourneyState((prev) => ({
              ...prev,
              conversionWindow: {
                ...prev.conversionWindow,
                value: Number.isFinite(nextValue)
                  ? nextValue
                  : prev.conversionWindow.value,
              },
            }));
          }}
          placeholder="1"
        />
        <SelectField
          value={draftUserJourneyState.conversionWindow.unit}
          onChange={(unit: "minute" | "hour") => {
            setDraftUserJourneyState((prev) => ({
              ...prev,
              conversionWindow: {
                ...prev.conversionWindow,
                unit,
              },
            }));
          }}
          options={[
            { label: "Minute(s)", value: "minute" },
            { label: "Hour(s)", value: "hour" },
          ]}
          isSearchable={false}
          style={{ width: 120 }}
          forceUndefinedValueToNull
        />
      </Flex>

      <Flex align="center" gap="2" wrap="wrap">
        {/* MKTODO: Need to add validation here so a user can select more than 1 day*/}
        <Text weight="medium">Show top</Text>
        <SelectField
          value={draftUserJourneyState.numOfEventsPerStep.toString()}
          sort={false}
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
        />
        <Text weight="medium">events per step</Text>
      </Flex>
    </Flex>
  );
}
