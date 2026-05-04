import { useForm } from "react-hook-form";
import React from "react";
import { TagInterface } from "shared/types/tag";
import { Text, Container } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import { RadixColor } from "@/ui/HelperText";
import { Select, SelectItem } from "@/ui/Select";
import Tag from "./Tag";

export const TAG_COLORS = [
  "blue",
  "teal",
  "pink",
  "orange",
  "lime",
  "gray",
  "gold",
] as const;

export default function TagsModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<TagInterface>;
  close: () => void;
  onSuccess: () => Promise<void>;
}) {
  const form = useForm<TagInterface>({
    defaultValues: {
      id: existing?.id || "",
      color: existing?.color || "blue",
      description: existing?.description || "",
    },
  });
  const { apiCall } = useAuth();

  // Add the existing color to the list of options if it's not already there
  // Necessary for hex colors that were converted to Radix colors that we don't
  // allow for new tags
  const colorOptions = existing.color
    ? [...new Set([...TAG_COLORS, existing.color])]
    : TAG_COLORS;

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      cta={existing?.id ? "Save Changes" : "Create Tag"}
      header={existing?.id ? `Edit Tag: ${existing.id}` : "Create Tag"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/tag`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        await onSuccess();
      })}
    >
      <div>
        {!existing?.id && (
          <Container mb="3">
            <Text as="label" size="3" weight="medium">
              Name
            </Text>
            <Field
              minLength={2}
              maxLength={64}
              className=""
              required
              {...form.register("id")}
            />
          </Container>
        )}
        <Select
          label="Color"
          value={form.watch("color")}
          setValue={(v) => form.setValue("color", v)}
          mb="3"
        >
          {colorOptions.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </Select>

        <Container mb="3">
          <Text as="label" size="3" weight="medium">
            Description
          </Text>
          <Field textarea maxLength={256} {...form.register("description")} />
        </Container>

        <Container>
          <Text as="label" size="3" weight="medium">
            Preview
          </Text>
          <div>
            {form.watch("id") && (
              <Tag
                tag={form.watch("id")}
                color={form.watch("color") as RadixColor}
                description={form.watch("description")}
                skipMargin
              />
            )}
          </div>
        </Container>
      </div>
    </Modal>
  );
}
