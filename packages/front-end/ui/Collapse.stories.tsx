import { useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import Collapse, { TargetingDetailsLink, CollapseTrigger } from "./Collapse";

export default function CollapseStories() {
  const [closed, setClosed] = useState(false);
  const [opened, setOpened] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);
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

      <Flex direction="column" gap="2" align="start">
        <Text size="2" weight="bold">
          On the experiment targeting tables
        </Text>
        <TargetingDetailsLink open={linkOpen} onOpenChange={setLinkOpen}>
          {linkOpen ? "Hide details" : "Show details"}
        </TargetingDetailsLink>
        <Collapse open={linkOpen}>
          <Text as="p">For where a full-width row is too heavy.</Text>
        </Collapse>
      </Flex>
    </Flex>
  );
}
