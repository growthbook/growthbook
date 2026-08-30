import { useState } from "react";
import { Flex, Grid } from "@radix-ui/themes";
import Text, { TextProps } from "./Text";
import { Select, SelectItem } from "./Select";

export default function TextStories() {
  const [textColor, setTextColor] = useState<TextProps["color"]>("text-mid");
  return (
    <Flex direction="row" gap="9">
      <Flex direction="column" gap="3">
        <span>Unwrapped text example</span>
        <Grid columns="repeat(3, 1fr)" gap="0.5rem">
          <Text size="sm" weight="regular" color={textColor}>
            body/small/regular
          </Text>
          <Text size="sm" weight="medium" color={textColor}>
            body/small/medium
          </Text>
          <Text size="sm" weight="semibold" color={textColor}>
            body/small/semibold
          </Text>
          <Text size="md" weight="regular" color={textColor}>
            body/medium/regular
          </Text>
          <Text size="md" weight="medium" color={textColor}>
            body/medium/medium
          </Text>
          <Text size="md" weight="semibold" color={textColor}>
            body/medium/semibold
          </Text>
          <Text size="lg" weight="regular" color={textColor}>
            body/large/regular
          </Text>
          <Text size="lg" weight="medium" color={textColor}>
            body/large/medium
          </Text>
          <Text size="lg" weight="semibold" color={textColor}>
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
          <SelectItem value="text-disabled">Text Disabled</SelectItem>
        </Select>
      </Flex>
    </Flex>
  );
}
