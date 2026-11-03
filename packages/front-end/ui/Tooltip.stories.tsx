import { Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import { StoryMeta } from "@/ui/storyMeta";
import Tooltip from "./Tooltip";

export const meta: StoryMeta = {
  name: "Tooltip",
  category: "overlays",
  status: "stable",
  summary: "A short text hint shown on hover or focus of a trigger.",
  useWhen: [
    "Explain an icon button or truncated label.",
    "Add a short hint without taking up space.",
  ],
  avoidWhen: [
    {
      reason: "The content is interactive or long.",
      use: "Popover",
    },
    {
      reason: "The text is essential and must always be visible.",
      use: "HelperText",
    },
  ],
  related: ["Popover", "TruncateMiddleWithTooltip"],
};

export default function TooltipStories() {
  return (
    <Flex gap="3">
      <Tooltip content="Helpful context">
        <Button variant="outline">Hover me</Button>
      </Tooltip>
      <Tooltip content="Never shown" enabled={false}>
        <Button variant="outline">Disabled tooltip</Button>
      </Tooltip>
    </Flex>
  );
}
