import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";

const FRUIT_OPTIONS = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Blueberry", value: "blueberry" },
  { label: "Cherry", value: "cherry" },
  { label: "Grape", value: "grape" },
  { label: "Mango", value: "mango" },
  { label: "Orange", value: "orange" },
  { label: "Strawberry", value: "strawberry" },
];

const GROUPED_OPTIONS = [
  {
    label: "Citrus",
    options: [
      { label: "Lemon", value: "lemon" },
      { label: "Lime", value: "lime" },
      { label: "Orange", value: "orange" },
      { label: "Grapefruit", value: "grapefruit" },
    ],
  },
  {
    label: "Berries",
    options: [
      { label: "Blueberry", value: "blueberry" },
      { label: "Raspberry", value: "raspberry" },
      { label: "Strawberry", value: "strawberry" },
    ],
  },
  {
    label: "Tropical",
    options: [
      { label: "Mango", value: "mango" },
      { label: "Pineapple", value: "pineapple" },
      { label: "Papaya", value: "papaya" },
    ],
  },
];

function SizeStory() {
  const [v1, setV1] = useState("apple");
  const [v2, setV2] = useState("banana");
  const [v3, setV3] = useState("mango");
  const [v4, setV4] = useState("cherry");
  return (
    <Flex direction="column" gap="3">
      <SelectField
        label="Size x-small"
        size="x-small"
        legacyLabelFormatting={false}
        value={v1}
        options={FRUIT_OPTIONS}
        onChange={setV1}
      />
      <SelectField
        label="Size small"
        size="small"
        legacyLabelFormatting={false}
        value={v2}
        options={FRUIT_OPTIONS}
        onChange={setV2}
      />
      <SelectField
        label="Size legacy (default)"
        legacyLabelFormatting={false}
        value={v3}
        options={FRUIT_OPTIONS}
        onChange={setV3}
      />
      <SelectField
        label="Size medium"
        size="medium"
        legacyLabelFormatting={false}
        value={v4}
        options={FRUIT_OPTIONS}
        onChange={setV4}
      />
    </Flex>
  );
}

function BasicStory() {
  const [value, setValue] = useState("apple");
  return (
    <SelectField
      label="Favourite fruit"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
    />
  );
}

function GroupedStory() {
  const [value, setValue] = useState("lemon");
  return (
    <SelectField
      label="Fruits by category"
      value={value}
      options={GROUPED_OPTIONS}
      onChange={setValue}
    />
  );
}

function CreatableStory() {
  const [value, setValue] = useState("custom-fruit");
  return (
    <SelectField
      label="Fruit (creatable)"
      helpText="Type a value and press Enter to add it"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
      createable
    />
  );
}

function DisabledStory() {
  return (
    <SelectField
      label="Disabled"
      value="apple"
      options={FRUIT_OPTIONS}
      onChange={() => {}}
      disabled
    />
  );
}

function WithErrorStory() {
  const [value, setValue] = useState("");
  return (
    <SelectField
      label="With error"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
      error="Please select an option"
    />
  );
}

function WithWarningStory() {
  const [value, setValue] = useState("apple");
  return (
    <SelectField
      label="With warning"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
      error="This option may affect performance"
      errorLevel="warning"
    />
  );
}

export default function SelectFieldStories() {
  return (
    <Flex direction="column" gap="4" maxWidth="420px">
      <SizeStory />
      <BasicStory />
      <GroupedStory />
      <CreatableStory />
      <DisabledStory />
      <WithErrorStory />
      <WithWarningStory />
    </Flex>
  );
}
