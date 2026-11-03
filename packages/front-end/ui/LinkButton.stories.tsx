import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import LinkButton from "./LinkButton";

export const meta: StoryMeta = {
  name: "LinkButton",
  category: "actions",
  status: "stable",
  summary:
    "A Button wrapped in a Next.js link, so it navigates to an href and looks like a button.",
  useWhen: [
    "A call to action that navigates to another page.",
    "Opening an external URL in a new tab with the external prop.",
  ],
  avoidWhen: [
    {
      reason: "The click runs an action instead of navigating.",
      use: "Button",
    },
    {
      reason: "Navigation inside body text.",
      use: "Link",
    },
  ],
  related: ["Button", "Link"],
};

export default function LinkButtonStories() {
  return (
    <Flex gap="3">
      <LinkButton href="/design-system">Internal link</LinkButton>
      <LinkButton href="https://docs.growthbook.io" external variant="outline">
        External link
      </LinkButton>
    </Flex>
  );
}
