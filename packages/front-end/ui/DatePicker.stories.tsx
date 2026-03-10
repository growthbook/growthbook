import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import DatePicker from "@/components/DatePicker";

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
        label={"Start"}
        label2={"End"}
        precision="date"
        disableBefore={new Date()}
        inputWidth={200}
      />
    </Flex>
  );
}
