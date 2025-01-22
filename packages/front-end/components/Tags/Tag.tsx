import React from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/components/Radix/Badge";
import { RadixColor } from "@/components/Radix/HelperText";

export const TAG_COLORS = [
  "blue",
  "teal",
  "pink",
  "orange",
  "lime",
  "gray",
  "gold",
] as const;

type Props = {
  tag: string;
  color?: RadixColor;
  description?: string;
  skipMargin?: boolean;
} & MarginProps;

export default function Tag({ tag, color, description, skipMargin }: Props) {
  const { getTagById } = useDefinitions();
  const fullTag = getTagById(tag);

  const displayTitle = description ?? fullTag?.description ?? "";

  const tagColor = color ?? fullTag?.color ?? "blue";

  return (
    <Badge
      title={displayTitle}
      label={tag}
      color={tagColor as RadixColor}
      variant="soft"
      mr={skipMargin ? undefined : "2"}
      mb={skipMargin ? undefined : "1"}
    />
  );
}

export function isLight(bgColor: string): boolean {
  if (!bgColor) return true;
  const color = bgColor.charAt(0) === "#" ? bgColor.substring(1, 7) : bgColor;
  const r = parseInt(color.substring(0, 2), 16); // hexToR
  const g = parseInt(color.substring(2, 4), 16); // hexToG
  const b = parseInt(color.substring(4, 6), 16); // hexToB
  return r * 0.299 + g * 0.587 + b * 0.114 > 186;
}
