import { useState } from "react";
import Field from "@/components/Forms/Field";
import RadioGroup from "./RadioGroup";

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
          renderOnSelect: <Field label="Another field" />,
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
