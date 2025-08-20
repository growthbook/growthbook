import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { Select, SelectItem, SelectSeparator } from "./Select";

export default function SelectStories() {
  const [selectValue, setSelectValue] = useState("carrot");

  return (
    <Flex direction="column" gap="3" maxWidth="300px">
      <Select
        label="Select"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
      >
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="carrot">Carrot</SelectItem>
        <SelectSeparator />
        <SelectItem value="apple-pie" disabled>
          Apple Pie (disabled)
        </SelectItem>
        <SelectItem value="carrot-cake">Carrot Cake</SelectItem>
      </Select>
      <Select
        label="Select with an error"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
        error="This is an error message"
      >
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="carrot">Carrot</SelectItem>
        <SelectSeparator />
        <SelectItem value="apple-pie">Apple Pie</SelectItem>
        <SelectItem value="carrot-cake">Carrot Cake</SelectItem>
      </Select>
      <Select
        label="Disabled Select"
        defaultValue="carrot"
        value={selectValue}
        setValue={setSelectValue}
        disabled
      >
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="carrot">Carrot</SelectItem>
        <SelectSeparator />
        <SelectItem value="apple-pie">Apple Pie</SelectItem>
        <SelectItem value="carrot-cake">Carrot Cake</SelectItem>
      </Select>
    </Flex>
  );
}
