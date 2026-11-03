import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import { StoryMeta } from "@/ui/storyMeta";
import ConfirmDialog from "./ConfirmDialog";

export const meta: StoryMeta = {
  name: "ConfirmDialog",
  category: "overlays",
  status: "stable",
  summary: "A small dialog that asks the user to confirm or cancel an action.",
  useWhen: [
    "Confirm a destructive or irreversible action.",
    "Ask a single yes or no question before proceeding.",
  ],
  avoidWhen: [
    {
      reason: "The dialog needs form fields or several steps.",
      use: "Modal",
    },
  ],
  related: ["Modal"],
};

export default function ConfirmDialogStories() {
  const [open, setOpen] = useState<"default" | "danger" | null>(null);
  return (
    <Flex gap="3">
      <Button onClick={() => setOpen("default")}>Open dialog</Button>
      <Button color="red" onClick={() => setOpen("danger")}>
        Open destructive dialog
      </Button>
      {open === "default" && (
        <ConfirmDialog
          title="Publish changes?"
          content="This will make the draft live in all environments."
          yesText="Publish"
          onConfirm={() => setOpen(null)}
          onCancel={() => setOpen(null)}
        />
      )}
      {open === "danger" && (
        <ConfirmDialog
          title="Delete feature?"
          content="This cannot be undone."
          yesText="Delete"
          color="red"
          onConfirm={async () => {
            await new Promise((r) => setTimeout(r, 500));
            throw new Error("Example error shown inside the dialog");
          }}
          onCancel={() => setOpen(null)}
        />
      )}
    </Flex>
  );
}
