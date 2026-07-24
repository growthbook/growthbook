import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { Select, SelectItem, SelectSeparator } from "./Select";

const ITEMS = (
  <>
    <SelectItem value="apple">Apple</SelectItem>
    <SelectItem value="carrot">Carrot</SelectItem>
    <SelectSeparator />
    <SelectItem value="apple-pie">Apple Pie</SelectItem>
    <SelectItem value="carrot-cake">Carrot Cake</SelectItem>
  </>
);

export default function SelectStories() {
  const [selectValue, setSelectValue] = useState("carrot");

  return (
    <Flex direction="column" gap="3" maxWidth="300px">
      <Select
        label="Size x-small"
        size="x-small"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
      >
        {ITEMS}
      </Select>
      <Select
        label="Size small (default)"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
      >
        {ITEMS}
      </Select>
      <Select
        label="Size legacy"
        size="legacy"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
      >
        {ITEMS}
      </Select>
      <Select
        label="Size medium"
        size="medium"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
      >
        {ITEMS}
      </Select>
      <Select
        label="With error"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
        error="This is an error message"
      >
        {ITEMS}
      </Select>
      <Select
        label="Disabled"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
        disabled
      >
        {ITEMS}
      </Select>
    </Flex>
  );
}
