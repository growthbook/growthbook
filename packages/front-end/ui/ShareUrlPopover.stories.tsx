import Button from "@/ui/Button";
import { StoryMeta } from "@/ui/storyMeta";
import ShareUrlPopover from "./ShareUrlPopover";

export const meta: StoryMeta = {
  name: "ShareUrlPopover",
  category: "overlays",
  status: "stable",
  summary:
    "A popover that shows a URL with a copy button so the user can share a link.",
  useWhen: ["Let users copy a shareable link to the current page or item."],
  avoidWhen: [
    {
      reason: "The popover holds anything other than a link to copy.",
      use: "Popover",
    },
  ],
  related: ["Popover"],
};

export default function ShareUrlPopoverStories() {
  return (
    <ShareUrlPopover
      trigger={<Button variant="outline">Share</Button>}
      url="https://app.growthbook.io/experiment/exp_123"
      title="Share experiment"
      description="Anyone in your organization with this link can view it."
    />
  );
}
