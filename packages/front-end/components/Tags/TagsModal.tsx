import { useForm } from "react-hook-form";
import React from "react";
import { TagInterface } from "shared/types/tag";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { RadixColor } from "@/ui/HelperText";
import { TextField } from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Tag from "./Tag";
import styles from "./TagsModal.module.scss";

const TAG_COLORS = [
  "blue",
  "sky",
  "cyan",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
  "violet",
  "gray",
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
  const isEdit = !!existing.id;
  const { tags } = useDefinitions();
  const form = useForm<TagInterface>({
    defaultValues: {
      id: existing.id || "",
      color: existing.color || "blue",
      description: existing.description || "",
    },
  });
  const { apiCall } = useAuth();

  const name = form.watch("id").trim();
  // Creating with an existing name would overwrite that tag.
  const duplicate =
    !isEdit && tags.find((t) => t.id.toLowerCase() === name.toLowerCase());
  // Legacy colors outside the palette stay selectable for existing tags.
  const colors = [
    ...new Set<string>([
      ...TAG_COLORS,
      ...(existing.color ? [existing.color] : []),
    ]),
  ];
  const option = (c: string) => (
    <Flex align="center" gap="3">
      <Tag tag={name || "Tag name"} color={c as RadixColor} skipMargin />
      <span>{c}</span>
    </Flex>
  );

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={isEdit ? "Edit Tag" : "Create Tag"}
      cta={isEdit ? "Save changes" : "Create tag"}
      ctaEnabled={isEdit || (name.length >= 2 && !duplicate)}
      submit={validatedSubmit(form, async (value) => {
        await apiCall(`/tag`, {
          method: "POST",
          body: JSON.stringify({
            ...value,
            // Edits must keep the exact id, which the server matches on.
            id: isEdit ? value.id : value.id.trim(),
          }),
        });
        await onSuccess();
      })}
    >
      <Flex direction="column" gap="4">
        {isEdit ? (
          <Flex direction="column" gap="1">
            <Text weight="semibold">Name</Text>
            <Text>{existing.id}</Text>
          </Flex>
        ) : (
          <TextField
            label="Name"
            autoFocus
            autoComplete="off"
            maxLength={64}
            error={
              duplicate
                ? `A tag named "${duplicate.id}" already exists.`
                : name.length === 1 && form.formState.touchedFields.id
                  ? "Use at least 2 characters."
                  : ""
            }
            {...form.register("id")}
          />
        )}
        <Select
          label="Color"
          value={form.watch("color")}
          setValue={(c) => form.setValue("color", c)}
        >
          {colors.map((c) => (
            <SelectItem key={c} value={c} className={styles.colorItem}>
              {option(c)}
            </SelectItem>
          ))}
        </Select>
        <Field
          label={
            <>
              Description <Text color="text-low">(optional)</Text>
            </>
          }
          textarea
          minRows={2}
          maxLength={256}
          containerClassName="mb-0"
          {...form.register("description")}
        />
      </Flex>
    </ModalStandard>
  );
}
