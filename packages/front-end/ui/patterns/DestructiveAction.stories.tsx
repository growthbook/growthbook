import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import ConfirmDialog from "@/ui/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Destructive Action",
  category: "patterns",
  status: "stable",
  summary:
    "Ask for confirmation before anything that can't be undone, and color the action red. In a row menu, put a red `DropdownMenuItem` last with a `confirmation` prop. From a button, open a `ConfirmDialog`.",
  useWhen: [
    "Delete or archive something that cannot be undone.",
    "Put the action last in a row menu, after a separator.",
  ],
  avoidWhen: [
    {
      reason: "The action collects input before it runs.",
      use: "Form in a Modal",
    },
  ],
  related: ["ConfirmDialog", "DropdownMenu", "Button"],
  examples: [
    "components/Experiment/Templates/TemplatesPage.tsx",
    "components/Settings/MemberPersonalAccessTokens.tsx",
  ],
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function DestructiveActionStory() {
  const [items, setItems] = useState(["Checkout template", "Pricing template"]);
  const [archived, setArchived] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  return (
    <Flex direction="column" gap="4" align="start">
      {items.map((item) => (
        <Flex key={item} align="center" gap="3">
          <Text>{item}</Text>
          <DropdownMenu
            trigger={<MoreMenuTrigger label={`Actions for ${item}`} />}
          >
            <DropdownMenuItem onClick={() => undefined}>Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              color="red"
              confirmation={{
                confirmationTitle: "Delete Template",
                cta: "Delete",
                ctaColor: "red",
                getConfirmationContent: async () =>
                  "Are you sure you want to delete this template? This action cannot be undone.",
                submit: async () => {
                  await wait(800);
                  setItems((prev) => prev.filter((i) => i !== item));
                },
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenu>
        </Flex>
      ))}
      {items.length === 0 && <Text color="text-low">All deleted.</Text>}
      <Button
        color="red"
        variant="outline"
        disabled={archived}
        onClick={() => setConfirmArchive(true)}
      >
        {archived ? "Archived" : "Archive experiment"}
      </Button>
      {confirmArchive && (
        <ConfirmDialog
          title="Archive this experiment?"
          content="It will be hidden from lists and stop updating results."
          yesText="Archive"
          color="red"
          onConfirm={async () => {
            await wait(800);
            setArchived(true);
            setConfirmArchive(false);
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </Flex>
  );
}
