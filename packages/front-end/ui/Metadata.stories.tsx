import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import Metadata from "./Metadata";

export const meta: StoryMeta = {
  name: "Metadata",
  category: "data-display",
  status: "stable",
  summary:
    "A single label and value, inline or stacked, with an optional row action.",
  useWhen: [
    "Small facts in a page header or side panel.",
    "A stacked row with its own edit button.",
  ],
  avoidWhen: [
    {
      reason: "A grid of many properties.",
      use: "DataList",
    },
  ],
  related: ["DataList"],
};

export default function MetadataStories() {
  return (
    <Flex gap="3">
      <Metadata label="Small" value="Data" size="sm" />
      <Metadata label="Medium" value="Data" size="md" />
    </Flex>
  );
}
