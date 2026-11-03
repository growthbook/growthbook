import Text from "@/ui/Text";
import { StoryMeta } from "@/ui/storyMeta";
import Frame from "./Frame";

export const meta: StoryMeta = {
  name: "Frame",
  category: "layout",
  status: "stable",
  summary: "A padded, bordered surface that groups related content on a page.",
  useWhen: [
    "Group a section of a page into a card-like panel.",
    "Replace legacy Bootstrap appbox containers.",
  ],
  avoidWhen: [
    {
      reason: "The content should expand and collapse.",
      use: "Collapse",
    },
  ],
  related: ["Collapse"],
};

export default function FrameStories() {
  return (
    <>
      <Frame>
        <Text>Default frame with background.</Text>
      </Frame>
      <Frame noBackground>
        <Text>Frame with noBackground.</Text>
      </Frame>
    </>
  );
}
