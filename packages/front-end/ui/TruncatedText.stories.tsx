import { Box, Flex } from "@radix-ui/themes";
import TruncatedText from "./TruncatedText";

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
