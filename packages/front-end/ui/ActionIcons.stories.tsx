import { Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import { StoryMeta } from "@/ui/storyMeta";
import {
  CopyIcon,
  EditIcon,
  FormatJsonIcon,
  FullscreenIcon,
} from "./ActionIcons";

export const meta: StoryMeta = {
  name: "ActionIcons",
  category: "actions",
  status: "stable",
  summary:
    "Preset icons for copy, fullscreen, edit, and format JSON buttons, scaled so they read clearly at small sizes.",
  useWhen: [
    "Rendering the icon inside a small copy, fullscreen, edit, or format button.",
  ],
  avoidWhen: [
    {
      reason: "You need a labeled action.",
      use: "Button",
    },
  ],
  related: ["Button"],
};

export default function ActionIconsStories() {
  return (
    <Flex direction="column" gap="3">
      <Flex gap="3" align="center">
        <CopyIcon />
        <CopyIcon copied />
        <FullscreenIcon />
        <FullscreenIcon exit />
        <FormatJsonIcon />
        <EditIcon />
      </Flex>
      <Flex gap="3" align="center">
        <Button size="sm" variant="ghost" icon={<CopyIcon size="sm" />}>
          Copy
        </Button>
        <Button size="sm" variant="ghost" icon={<EditIcon size="sm" />}>
          Edit
        </Button>
      </Flex>
    </Flex>
  );
}
