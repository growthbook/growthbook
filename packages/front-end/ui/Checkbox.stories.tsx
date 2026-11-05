import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import Checkbox from "./Checkbox";

export const meta: StoryMeta = {
  name: "Checkbox",
  category: "inputs",
  status: "stable",
  summary:
    "Labeled checkbox with optional description, sizes, and error and disabled states.",
  useWhen: [
    "A boolean option inside a form that is saved on submit.",
    "Selecting rows or items from a list.",
  ],
  avoidWhen: [
    {
      reason: "The toggle applies a setting immediately.",
      use: "Switch",
    },
    {
      reason: "Exactly one of several options must be picked.",
      use: "RadioGroup",
    },
  ],
  related: ["Switch", "RadioGroup"],
};

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
