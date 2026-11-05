import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import PermissionBlocker from "./PermissionBlocker";

export const meta: StoryMeta = {
  name: "PermissionBlocker",
  category: "feedback",
  status: "stable",
  summary:
    "Amber helper text with a crossed circle that explains why the viewer cannot use a disabled control.",
  useWhen: ["Explain a permission denial next to a disabled control."],
  avoidWhen: [
    {
      reason: "The note is informational or applies to everyone.",
      use: "HelperText",
    },
    {
      reason: "The block is about a paid plan, not a permission.",
      use: "PremiumCallout",
    },
  ],
  related: ["HelperText"],
};

export default function PermissionBlockerStories() {
  return (
    <Flex direction="column" gap="3">
      <PermissionBlocker>
        You don&apos;t have permission to edit this Feature Flag.
      </PermissionBlocker>
      <PermissionBlocker size="md">
        You don&apos;t have permission to publish to production.
      </PermissionBlocker>
    </Flex>
  );
}
