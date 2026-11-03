import { Flex } from "@radix-ui/themes";
import { PiInfoFill } from "react-icons/pi";
import { StoryMeta } from "@/ui/storyMeta";
import Avatar from "./Avatar";

export const meta: StoryMeta = {
  name: "Avatar",
  category: "data-display",
  status: "stable",
  summary:
    "Round or square badge for a person or entity, holding initials, an icon, or an image.",
  useWhen: ["Identifying a user or owner next to a name."],
  avoidWhen: [
    {
      reason: "Labeling a status or category.",
      use: "Badge",
    },
  ],
  related: ["Badge"],
};

export default function AvatarStories() {
  return (
    <Flex direction="row" gap="3">
      <Avatar>BF</Avatar>
      <Avatar color="green">
        <PiInfoFill size={25} />
      </Avatar>
      <Avatar size="lg" radius="small">
        <img src="https://app.growthbook.io/logo/growth-book-logomark-white.svg" />
      </Avatar>
      <Avatar color="orange" variant="soft" size="sm">
        sm
      </Avatar>
      <Avatar ring>BF</Avatar>
      <Avatar ring color="green" variant="soft">
        AB
      </Avatar>
    </Flex>
  );
}
