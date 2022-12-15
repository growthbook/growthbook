import { useForm } from "react-hook-form";
import { HexColorPicker } from "react-colorful";
import React from "react";
import { TagInterface } from "back-end/types/tag";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import styles from "./TagsModal.module.scss";
import Tag from "./Tag";

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
      color: existing?.color || "#029dd1",
      description: existing?.description || "",
    },
  });
  const { apiCall } = useAuth();

  const tagColors = [
    { value: "#029dd1", label: "light-blue" },
    { value: "#0047bd", label: "blue" },
    { value: "#F170AC", label: "pink" },
    { value: "#D64538", label: "red" },
    { value: "#fc8414", label: "orange" },
    { value: "#e2d221", label: "yellow" },
    { value: "#9edd63", label: "lime" },
    { value: "#28A66B", label: "green" },
    { value: "#20C9B9", label: "teal" },
  ];

  return (
    <Modal
      open={true}
      close={close}
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
            name="Name"
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
          <HexColorPicker
            onChange={(c) => {
              form.setValue("color", c);
            }}
            style={{ margin: "0 auto" }}
            color={form.watch("color") || ""}
            id="tagcolor"
          />
          <div className={styles.picker__swatches}>
            {tagColors.map((c) => (
              <button
                key={c.value}
                className={styles.picker__swatch}
                style={{ background: c.value }}
                onClick={(e) => {
                  e.preventDefault();
                  form.setValue("color", c.value);
                }}
              />
            ))}
          </div>
        </div>
        <Field
          name="Name"
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
              color={form.watch("color")}
              description={form.watch("description")}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
