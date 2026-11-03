import { Box, Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import TruncatedText from "./TruncatedText";

export const meta: StoryMeta = {
  name: "TruncatedText",
  category: "typography",
  status: "stable",
  summary:
    "Text cut off with an ellipsis at the available width, with the full text in a focusable tooltip.",
  useWhen: ["Names or values that can overflow a fixed-width cell or row."],
  avoidWhen: [
    {
      reason: "IDs or keys where the start and end both matter.",
      use: "TruncateMiddleWithTooltip",
    },
  ],
  related: ["Text", "TruncateMiddleWithTooltip"],
};

export default function TruncatedTextStories() {
  return (
    <Flex direction="column" gap="3">
      <Box width="200px">
        <TruncatedText text="Fits its container" />
      </Box>
      <Box width="200px">
        <TruncatedText text="A long value cut off to fit its container, in full on hover or focus" />
      </Box>
      <div>
        Inline, up to a width:{" "}
        <TruncatedText
          weight="semibold"
          maxWidth={160}
          text="a-very-long-feature-flag-key"
        />
      </div>
    </Flex>
  );
}
