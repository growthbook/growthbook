import React from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/components/Badge";

interface Props {
  tag: string;
  color?: string;
  description?: string;
}

export default function Tag({ tag, color, description }: Props) {
  const { getTagById } = useDefinitions();
  const fullTag = getTagById(tag);

  const displayTitle = description ?? fullTag?.description ?? "";
  const displayColor = color ?? fullTag?.color ?? "#029dd1";

  return (
    <Badge
      className={"tag badge-primary"}
      title={displayTitle}
      content={tag}
      style={{
        backgroundColor: displayColor,
        color: isLight(displayColor) ? "#000000" : "#ffffff",
        cursor: "default",
      }}
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
