import { useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import Collapse, { CollapseTrigger } from "./Collapse";

export default function CollapseStories() {
  const [closed, setClosed] = useState(false);
  const [opened, setOpened] = useState(true);
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Closed, caret at the end
        </Text>
        <CollapseTrigger open={closed} onOpenChange={setClosed}>
          <Text weight="medium">Advanced</Text>
        </CollapseTrigger>
        <Collapse open={closed}>
          <Text as="p">Mounted the first time it opens.</Text>
        </Collapse>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Open, caret at the start
        </Text>
        <CollapseTrigger open={opened} onOpenChange={setOpened} caret="start">
          <Text weight="medium">Details</Text>
        </CollapseTrigger>
        <Collapse open={opened}>
          <Text as="p">Slides shut, and its contents leave the tab order.</Text>
        </Collapse>
      </Flex>
    </Flex>
  );
}
