import { useState } from "react";
import { Flex, Grid, Separator } from "@radix-ui/themes";
import Heading, { HeadingProps } from "./Heading";
import { Select, SelectItem } from "./Select";
import Text from "./Text";
import Callout from "./Callout";

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
          <Callout status="warning">
            <Text size="medium">
              Unstyled headings are for reference only, not recommended for new
              usages.
            </Text>
          </Callout>
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
