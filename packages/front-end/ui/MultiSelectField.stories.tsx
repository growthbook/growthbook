import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import MultiSelectField from "./MultiSelectField";

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

function BasicStory() {
  const [value, setValue] = useState<string[]>(["apple", "banana"]);
  return (
    <MultiSelectField
      label="Favourite fruits"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
    />
  );
}

function SizeStory() {
  const [v1, setV1] = useState<string[]>(["apple"]);
  const [v2, setV2] = useState<string[]>(["banana"]);
  const [v3, setV3] = useState<string[]>(["mango"]);
  return (
    <Flex direction="column" gap="3">
      <MultiSelectField
        label="Size small"
        size="small"
        legacyLabelFormatting={false}
        value={v1}
        options={FRUIT_OPTIONS}
        onChange={setV1}
      />
      <MultiSelectField
        label="Size legacy (default)"
        legacyLabelFormatting={false}
        value={v2}
        options={FRUIT_OPTIONS}
        onChange={setV2}
      />
      <MultiSelectField
        label="Size medium"
        size="medium"
        legacyLabelFormatting={false}
        value={v3}
        options={FRUIT_OPTIONS}
        onChange={setV3}
      />
    </Flex>
  );
}

function GroupedStory() {
  const [value, setValue] = useState<string[]>(["lemon", "blueberry"]);
  return (
    <MultiSelectField
      label="Fruits by category"
      value={value}
      options={GROUPED_OPTIONS}
      onChange={setValue}
    />
  );
}

function CreatableStory() {
  const [value, setValue] = useState<string[]>(["custom-tag"]);
  return (
    <MultiSelectField
      label="Tags (creatable)"
      helpText="Type a value and press Enter to add it"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
      creatable
    />
  );
}

function CreatableNoMenuStory() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <MultiSelectField
      label="Free-form values (no dropdown)"
      helpText="Type a value and press Enter. No dropdown is shown."
      value={value}
      options={[]}
      onChange={setValue}
      creatable
      noMenu
    />
  );
}

function DisabledStory() {
  return (
    <MultiSelectField
      label="Disabled"
      value={["apple", "banana"]}
      options={FRUIT_OPTIONS}
      onChange={() => {}}
      disabled
    />
  );
}

function WithErrorStory() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <MultiSelectField
      label="With error"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
      error="Please select at least one option"
    />
  );
}

function WithWarningStory() {
  const [value, setValue] = useState<string[]>(["apple"]);
  return (
    <MultiSelectField
      label="With warning"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
      error="Selecting too many options may impact performance"
      errorLevel="warning"
    />
  );
}

function NoCopyButtonStory() {
  const [value, setValue] = useState<string[]>(["apple", "banana"]);
  return (
    <MultiSelectField
      label="No copy button"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
      showCopyButton={false}
    />
  );
}

function NonSortableStory() {
  const [value, setValue] = useState<string[]>(["apple", "banana", "mango"]);
  return (
    <MultiSelectField
      label="Non-sortable"
      value={value}
      options={FRUIT_OPTIONS}
      onChange={setValue}
      sort={false}
    />
  );
}

export default function MultiSelectFieldStories() {
  return (
    <Flex direction="column" gap="4" maxWidth="420px">
      <SizeStory />
      <BasicStory />
      <GroupedStory />
      <CreatableStory />
      <CreatableNoMenuStory />
      <NoCopyButtonStory />
      <NonSortableStory />
      <DisabledStory />
      <WithErrorStory />
      <WithWarningStory />
    </Flex>
  );
}
