import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import DatePicker from "@/components/DatePicker";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "DatePicker",
  category: "inputs",
  status: "stable",
  summary:
    "Date or date range picker with optional time. The component lives in components/DatePicker, not @/ui.",
  useWhen: [
    "Picking a single date or a start and end date, with or without a time.",
  ],
  avoidWhen: [],
  related: ["TextField"],
};

export default function DatePickerStories() {
  const [date1, setDate1] = useState<Date | undefined>();
  const [date2, setDate2] = useState<Date | undefined>();

  return (
    <Flex direction="column" gap="3">
      <DatePicker
        label="Choose Date"
        helpText="width: 170"
        date={date1}
        setDate={setDate1}
        precision="datetime"
        disableBefore={new Date()}
        inputWidth={170}
      />

      <DatePicker
        helpText="width: default (100%)"
        date={date1}
        setDate={setDate1}
        precision="datetime"
        disableBefore={new Date()}
      />

      <DatePicker
        date={date1}
        date2={date2}
        setDate={setDate1}
        setDate2={setDate2}
        label="Range"
        precision="date"
        disableBefore={new Date()}
        inputWidth={200}
      />
    </Flex>
  );
}
