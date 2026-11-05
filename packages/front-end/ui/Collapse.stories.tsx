import { useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import Collapse, { CollapseTrigger } from "./Collapse";

export const meta: StoryMeta = {
  name: "Collapse",
  category: "layout",
  status: "stable",
  summary:
    "Content that slides open and shut, with an optional caret trigger. Content mounts on first open.",
  useWhen: ["Hide advanced or secondary content until the user asks for it."],
  avoidWhen: [
    {
      reason: "The sections are peers the user switches between.",
      use: "Tabs",
    },
  ],
  related: ["Frame"],
};

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
