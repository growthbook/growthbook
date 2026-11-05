import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import Callout from "./Callout";

export const meta: StoryMeta = {
  name: "Callout",
  category: "feedback",
  status: "stable",
  summary:
    "An inline message box that reports status or gives context, with info, warning, error, and success variants.",
  useWhen: [
    "Explain a state or risk inside a page or form.",
    "Show an error returned from a failed request.",
  ],
  avoidWhen: [
    {
      reason: "The message is a premium upsell.",
      use: "PremiumCallout",
    },
    {
      reason: "The note belongs to a single field.",
      use: "HelperText",
    },
    {
      reason: "You need to show raw error output or a stack trace.",
      use: "ErrorDisplay",
    },
  ],
  related: ["PremiumCallout", "ErrorDisplay"],
};

export default function CalloutStories() {
  return (
    <Flex direction="column" gap="3" mb="4">
      <Callout status="info">This is an informational callout.</Callout>
      <Callout status="warning">This is a warning callout.</Callout>
      <Callout status="error">This is an error callout.</Callout>
      <Callout status="success">This is a success callout.</Callout>
    </Flex>
  );
}
