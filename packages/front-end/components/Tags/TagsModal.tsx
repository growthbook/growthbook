import { useForm } from "react-hook-form";
import React from "react";
import { TagInterface } from "back-end/types/tag";
import { Text, Container } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import { RadixColor } from "@/components/Radix/HelperText";
import { Select, SelectItem } from "@/components/Radix/Select";
import Tag from "./Tag";

// 保留原始英文颜色名的映射，以确保颜色样式能正确应用
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
      cta={existing?.id ? "保存更改" : "创建标签"}
      header={existing?.id ? `编辑标签：${existing.id}` : "创建标签"}
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
              名称
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
          label="颜色"
          value={form.watch("color")}
          setValue={(v) => form.setValue("color", v)}
          mb="3"
        >
          {colorOptions.map((colorOption) => (
            <SelectItem key={colorOption} value={colorOption}>
              {getChineseColorDisplayName(colorOption)}
            </SelectItem>
          ))}
        </Select>

        <Container mb="3">
          <Text as="label" size="3" weight="medium">
            描述
          </Text>
          <Field textarea maxLength={256} {...form.register("description")} />
        </Container>

        <Container>
          <Text as="label" size="3" weight="medium">
            预览
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

// 定义一个函数用于将英文颜色名映射为中文显示名称
function getChineseColorDisplayName(color) {
  const colorDisplayNameMap = {
    "blue": "蓝色",
    "teal": "青绿色",
    "pink": "粉色",
    "orange": "橙色",
    "lime": "青柠色",
    "gray": "灰色",
    "gold": "金色",
  };

  return colorDisplayNameMap[color] || color;
}