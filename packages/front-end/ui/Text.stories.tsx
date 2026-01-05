import { useState } from "react";
import { Flex, Grid } from "@radix-ui/themes";
import Text, { TextProps } from "./Text";
import { Select, SelectItem } from "./Select";

export default function StepperStories() {
  const [textColor, setTextColor] = useState<TextProps["color"]>("text-mid");
  return (
    <Flex direction="row" gap="9">
      <Flex direction="column" gap="1">
        <span>Unwrapped text</span>
        <Grid columns="repeat(3, 1fr)" gap="0.5rem">
          <Text size="medium" weight="regular" color={textColor}>
            Unwrapped text
          </Text>
          <Text size="medium" weight="medium" color={textColor}>
            body/medium/medium
          </Text>
          <Text size="medium" weight="semibold" color={textColor}>
            body/medium/semibold
          </Text>
          <Text size="large" weight="regular" color={textColor}>
            body/large/regular
          </Text>
          <Text size="large" weight="medium" color={textColor}>
            body/large/medium
          </Text>
          <Text size="large" weight="semibold" color={textColor}>
            body/large/semibold
          </Text>
        </Grid>
      </Flex>

      <Flex flexGrow="1" direction="column" gap="0">
        <Text weight="semibold" mb="2">
          Color
        </Text>
        <Select
          value={textColor}
          setValue={(value) => setTextColor(value as TextProps["color"])}
        >
          <SelectItem value="text-high">Text High</SelectItem>
          <SelectItem value="text-mid">Text Mid</SelectItem>
          <SelectItem value="text-low">Text Low</SelectItem>
          <SelectItem value="gray">Gray</SelectItem>
          <SelectItem value="gold">Gold</SelectItem>
          <SelectItem value="bronze">Bronze</SelectItem>
          <SelectItem value="brown">Brown</SelectItem>
          <SelectItem value="yellow">Yellow</SelectItem>
          <SelectItem value="amber">Amber</SelectItem>
          <SelectItem value="orange">Orange</SelectItem>
          <SelectItem value="tomato">Tomato</SelectItem>
          <SelectItem value="red">Red</SelectItem>
          <SelectItem value="ruby">Ruby</SelectItem>
          <SelectItem value="crimson">Crimson</SelectItem>
          <SelectItem value="pink">Pink</SelectItem>
          <SelectItem value="plum">Plum</SelectItem>
          <SelectItem value="purple">Purple</SelectItem>
          <SelectItem value="violet">Violet</SelectItem>
          <SelectItem value="iris">Iris</SelectItem>
          <SelectItem value="indigo">Indigo</SelectItem>
          <SelectItem value="blue">Blue</SelectItem>
          <SelectItem value="cyan">Cyan</SelectItem>
          <SelectItem value="teal">Teal</SelectItem>
          <SelectItem value="jade">Jade</SelectItem>
          <SelectItem value="green">Green</SelectItem>
          <SelectItem value="grass">Grass</SelectItem>
          <SelectItem value="lime">Lime</SelectItem>
          <SelectItem value="mint">Mint</SelectItem>
          <SelectItem value="sky">Sky</SelectItem>
        </Select>
      </Flex>
    </Flex>
  );
}
