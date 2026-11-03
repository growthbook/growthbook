import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import { TruncateMiddleWithTooltip } from "./TruncateMiddleWithTooltip";

export const meta: StoryMeta = {
  name: "TruncateMiddleWithTooltip",
  category: "typography",
  status: "stable",
  summary:
    "Shows the start and end of a long string with an ellipsis in the middle, and the full text in a tooltip.",
  useWhen: [
    "IDs, keys, or paths where the start and end both matter.",
    "Table cells with a character or width limit.",
  ],
  avoidWhen: [
    {
      reason: "Prose or names where the start is enough.",
      use: "TruncatedText",
    },
  ],
  related: ["TruncatedText", "Tooltip"],
};

export default function TruncateMiddleWithTooltipStories() {
  return (
    <Flex direction="column" gap="2">
      <TruncateMiddleWithTooltip
        text="analytics.events_2024_production_checkout_completed"
        maxChars={30}
      />
      <TruncateMiddleWithTooltip text="short_name" maxChars={30} />
    </Flex>
  );
}
