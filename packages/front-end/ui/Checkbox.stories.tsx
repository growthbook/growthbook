import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Checkbox from "./Checkbox";

export default function CheckboxStories() {
  const [checked, setChecked] = useState<"indeterminate" | boolean>(false);
  return (
    <Flex direction="column" gap="3">
      <Checkbox
        label="Checkbox Label"
        value={checked}
        setValue={(v) => {
          setChecked(v);
        }}
      />
      <Checkbox
        label="Checkbox With Description"
        value={checked}
        setValue={(v) => {
          setChecked(v);
        }}
        description="This is a description"
      />
      <Checkbox
        label="Checkbox in Indeterminate State"
        value={"indeterminate"}
        setValue={(v) => {
          setChecked(v);
        }}
      />
      <Checkbox
        label="Checkbox With Warning (and description)"
        value={checked}
        setValue={(v) => {
          setChecked(v);
        }}
        description="This is a description"
        error="This is a warning message"
        errorLevel="warning"
      />
      <Checkbox
        label="Checkbox With Error"
        value={checked}
        setValue={(v) => {
          setChecked(v);
        }}
        error="This is an error message"
      />
      <Checkbox
        label="Disabled"
        value={checked}
        setValue={(v) => {
          setChecked(v);
        }}
        disabled
      />
    </Flex>
  );
}
