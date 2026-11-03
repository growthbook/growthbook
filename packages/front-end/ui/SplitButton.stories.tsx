import { Flex } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import Button from "@/ui/Button";
import { StoryMeta } from "@/ui/storyMeta";
import SplitButton from "./SplitButton";

export const meta: StoryMeta = {
  name: "SplitButton",
  category: "actions",
  status: "stable",
  summary:
    "Joins two or more button segments into one control, usually a primary action plus a dropdown trigger.",
  useWhen: [
    "A primary action has secondary variants in an attached menu.",
    "Grouping a few closely related buttons as one visual unit.",
  ],
  avoidWhen: [
    {
      reason: "There is only one action.",
      use: "Button",
    },
    {
      reason: "All actions are equal and belong in a menu.",
      use: "DropdownMenu",
    },
  ],
  related: ["Button", "DropdownMenu"],
};

export default function SplitButtonStories() {
  return (
    <Flex direction="column" gap="3" align="start">
      <SplitButton
        menu={
          <Button>
            <PiCaretDown />
          </Button>
        }
      >
        <Button>Save</Button>
      </SplitButton>
      <SplitButton variant="outline">
        {[
          <Button key="a" variant="outline">
            Left
          </Button>,
          <Button key="b" variant="outline">
            Middle
          </Button>,
          <Button key="c" variant="outline">
            Right
          </Button>,
        ]}
      </SplitButton>
    </Flex>
  );
}
