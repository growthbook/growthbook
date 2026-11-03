import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import Button from "@/ui/Button";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Form in a Modal",
  category: "patterns",
  status: "stable",
  summary:
    "Build create and edit forms with `ModalStandard` and react-hook-form, and submit through `validatedSubmit`. Throw on failure: the modal shows the error, keeps the user's input, and only closes on success.",
  useWhen: [
    "Create or edit a resource without leaving the page.",
    "Use one modal for create and edit, switched by an existing value.",
  ],
  avoidWhen: [
    {
      reason: "You only need a yes or no answer.",
      use: "Destructive Action",
    },
    {
      reason: "The layout needs more than a header, body, and footer.",
      use: "Modal",
    },
  ],
  related: ["Modal", "TextField", "Select", "Destructive Action"],
  examples: [
    "components/Tags/TagsModal.tsx",
    "components/Projects/ProjectModal.tsx",
  ],
};

type FormValues = { name: string; color: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function TagModal({
  existing,
  close,
  onSuccess,
}: {
  existing: FormValues | null;
  close: () => void;
  onSuccess: (value: FormValues) => void;
}) {
  const form = useForm<FormValues>({
    defaultValues: {
      name: existing?.name ?? "",
      color: existing?.color ?? "blue",
    },
  });
  const isEdit = existing !== null;

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={isEdit ? "Edit Tag" : "Create Tag"}
      cta={isEdit ? "Save changes" : "Create tag"}
      submit={validatedSubmit(form, async (value) => {
        await wait(800);
        // Errors thrown here show at the top of the modal.
        if (value.name.trim().toLowerCase() === "taken") {
          throw new Error('A tag named "taken" already exists.');
        }
        onSuccess(value);
      })}
    >
      <Flex direction="column" gap="4">
        <TextField
          label="Name"
          markRequired
          autoComplete="off"
          helpText='Try "taken" to see a submit error.'
          error={form.formState.errors.name?.message}
          {...form.register("name", {
            validate: (v) =>
              v.trim().length >= 2 ? true : "Use at least 2 characters.",
          })}
        />
        <Select
          label="Color"
          value={form.watch("color")}
          setValue={(c) => form.setValue("color", c)}
        >
          <SelectItem value="blue">Blue</SelectItem>
          <SelectItem value="green">Green</SelectItem>
          <SelectItem value="orange">Orange</SelectItem>
        </Select>
      </Flex>
    </ModalStandard>
  );
}

export default function FormModalStory() {
  const [saved, setSaved] = useState<FormValues | null>(null);
  const [open, setOpen] = useState<"create" | "edit" | null>(null);

  return (
    <Flex direction="column" gap="3" align="start">
      <Flex gap="3">
        <Button onClick={() => setOpen("create")}>Create tag</Button>
        <Button
          variant="outline"
          disabled={saved === null}
          onClick={() => setOpen("edit")}
        >
          Edit tag
        </Button>
      </Flex>
      <Text color="text-mid">
        {saved
          ? `Saved "${saved.name}" in ${saved.color}.`
          : "Nothing saved yet."}
      </Text>
      {open ? (
        <TagModal
          existing={open === "edit" ? saved : null}
          close={() => setOpen(null)}
          onSuccess={setSaved}
        />
      ) : null}
    </Flex>
  );
}
