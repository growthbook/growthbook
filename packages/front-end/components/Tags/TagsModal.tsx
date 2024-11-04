import { useForm } from "react-hook-form";
import React from "react";
import { TagInterface } from "back-end/types/tag";
import { Button, Container } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import { RadixColor } from "@/components/Radix/HelperText";
import styles from "./TagsModal.module.scss";
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
      <div className="colorpicker tagmodal">
        {!existing?.id && (
          <Field
            label="Name"
            minLength={2}
            maxLength={64}
            className=""
            required
            {...form.register("id")}
          />
        )}
        <label>Color:</label>
        <div className={styles.picker}>
          <Container
            style={{
              background: "var(--color-background)",
              borderRadius: "var(--radius-3)",
            }}
            p="4"
          >
            {TAG_COLORS.map((c) => (
              <Button
                key={c}
                radius="full"
                color={c}
                onClick={(e) => {
                  e.preventDefault();
                  form.setValue("color", c);
                }}
                mr="2"
                mt="1"
                mb="1"
                style={{ height: "32px", width: "32px" }}
              />
            ))}
          </Container>
        </div>
        <Field
          label="Description"
          textarea
          maxLength={256}
          {...form.register("description")}
        />
        <div>
          <label>Preview</label>
          <div>
            <Tag
              tag={form.watch("id")}
              color={form.watch("color") as RadixColor}
              description={form.watch("description")}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
