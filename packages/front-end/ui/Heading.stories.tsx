import { useState } from "react";
import { Flex, Grid, Separator } from "@radix-ui/themes";
import Heading, { HeadingProps } from "./Heading";
import { Select, SelectItem } from "./Select";
import Text from "./Text";

export default function HeadingStories() {
  const [headingColor, setHeadingColor] =
    useState<HeadingProps["color"]>("text-mid");
  return (
    <Flex direction="column" gap="5">
      <Flex flexGrow="1" direction="column" gap="0">
        <Text weight="semibold" mb="2">
          Color
        </Text>
        <Select
          value={headingColor}
          setValue={(value) => setHeadingColor(value as HeadingProps["color"])}
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
      <Flex direction="column" gap="3">
        <Grid columns="repeat(2, 1fr)" gap="2" align="baseline">
          <Heading as="h3" size="small" weight="medium" color={headingColor}>
            heading/small/medium
          </Heading>
          <Heading as="h3" size="small" weight="semibold" color={headingColor}>
            heading/small/semibold
          </Heading>
          <Heading as="h3" size="medium" weight="medium" color={headingColor}>
            heading/medium/medium
          </Heading>
          <Heading as="h3" size="medium" weight="semibold" color={headingColor}>
            heading/medium/semibold
          </Heading>
          <Heading as="h3" size="large" weight="medium" color={headingColor}>
            heading/large/medium
          </Heading>
          <Heading as="h3" size="large" weight="semibold" color={headingColor}>
            heading/large/semibold
          </Heading>
          <Heading as="h3" size="x-large" weight="medium" color={headingColor}>
            heading/x-large/medium
          </Heading>
          <Heading
            as="h3"
            size="x-large"
            weight="semibold"
            color={headingColor}
          >
            heading/x-large/semibold
          </Heading>
          <Heading as="h3" size="2x-large" weight="medium" color={headingColor}>
            heading/2x-large/medium
          </Heading>
          <Heading
            as="h3"
            size="2x-large"
            weight="semibold"
            color={headingColor}
          >
            heading/2x-large/semibold
          </Heading>
        </Grid>
        <Separator size="4" />
        <Flex direction="column" gap="2">
          <Text size="large" color="amber">
            Unstyled headings are for reference only, not recommended for new
            usages.
          </Text>
          <h1>Unstyled h1</h1>
          <h2>Unstyled h2</h2>
          <h3>Unstyled h3</h3>
          <h4>Unstyled h4</h4>
          <h5>Unstyled h5</h5>
          <h6>Unstyled h6</h6>
        </Flex>
      </Flex>
    </Flex>
  );
}
