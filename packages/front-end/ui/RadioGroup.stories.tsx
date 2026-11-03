import { useState } from "react";
import Field from "@/components/Forms/Field";
import { StoryMeta } from "@/ui/storyMeta";
import RadioGroup from "./RadioGroup";

export const meta: StoryMeta = {
  name: "RadioGroup",
  category: "inputs",
  status: "stable",
  summary:
    "Vertical or horizontal list of labeled radio options where exactly one is selected.",
  useWhen: [
    "Two to five mutually exclusive options that should all be visible.",
  ],
  avoidWhen: [
    {
      reason:
        "Options need rich content such as descriptions or icons in a card.",
      use: "RadioCards",
    },
    {
      reason: "Many options or limited space.",
      use: "Select",
    },
  ],
  related: ["RadioCards", "SegmentedControl", "Checkbox"],
};

export default function RadioGroupStories() {
  const [radioSelected, setRadioSelected] = useState("k1");

  return (
    <RadioGroup
      value={radioSelected}
      setValue={(v) => {
        setRadioSelected(v);
      }}
      options={[
        {
          value: "k1",
          label: "Radio 1",
        },
        {
          value: "k2",
          label: "Radio 2",
        },
        {
          value: "k3",
          label: "Radio 3, with description",
          description: "This is a description",
        },
        {
          value: "k4",
          label: "Progressive disclosure",
          description: "Click to render element",
          renderOnSelect: <Field size="legacy" label="Another field" />,
        },
        {
          value: "k5",
          label: "Radio 4, with error",
          error: "This is an error",
          errorLevel: "error",
        },
        {
          value: "k6",
          label: "Radio 5, with warning",
          error:
            "When making multiple changes at the same time, it can be difficult to control for the impact of each change." +
            "              The risk of introducing experimental bias increases. Proceed with caution.",
          errorLevel: "warning",
        },
        {
          value: "k7",
          label: "Radio 6, disabled",
          description: "This is a description",
          disabled: true,
        },
        {
          value: "k8",
          label: "Radio 7, disabled with error",
          description: "This is a description",
          disabled: true,
          error: "This is an error",
          errorLevel: "error",
        },
      ]}
    />
  );
}
