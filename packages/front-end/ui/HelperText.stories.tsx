import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import HelperText from "./HelperText";

export const meta: StoryMeta = {
  name: "HelperText",
  category: "inputs",
  status: "stable",
  summary:
    "Small status text with an icon for info, warning, error, and success messages next to a field or control.",
  useWhen: [
    "Inline validation or guidance under a form field.",
    "A short status note next to a control.",
  ],
  avoidWhen: [
    {
      reason: "A message that needs a title, actions, or more emphasis.",
      use: "Callout",
    },
  ],
  related: ["Callout", "TextField"],
};

export default function HelperTextStories() {
  return (
    <Flex direction="column" gap="3">
      <HelperText status="info">This is an info message</HelperText>
      <HelperText status="warning">This is a warning message</HelperText>
      <HelperText status="error">This is an error message</HelperText>
      <HelperText status="success">This is a success message</HelperText>
    </Flex>
  );
}
