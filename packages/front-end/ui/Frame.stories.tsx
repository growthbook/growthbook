import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { StoryMeta } from "@/ui/storyMeta";
import Frame from "./Frame";

export const meta: StoryMeta = {
  name: "Frame",
  category: "layout",
  status: "stable",
  summary:
    'A padded, bordered surface that groups related content on a page. Defaults to `py="5"`, `px="6"` and `mb="4"`; it takes any Radix `Box` prop to override spacing.',
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
        <Heading as="h3" size="md" mb="2">
          Default Spacing
        </Heading>
        <Text>Most pages use a plain Frame with no props.</Text>
      </Frame>
      <Frame px="4" py="3" mb="0">
        <Text>Compact spacing with px, py and mb overrides.</Text>
      </Frame>
    </>
  );
}
