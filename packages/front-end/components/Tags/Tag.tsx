import React from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/components/Radix/Badge";
import { RadixColor } from "@/components/Radix/HelperText";

export const TAG_COLORS: RadixColor[] = [
  "gray",
  "gold",
  "bronze",
  "brown",
  "yellow",
  "amber",
  "orange",
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "lime",
  "mint",
  "sky",
];

interface Props {
  tag: string;
  color?: RadixColor;
  description?: string;
  skipMargin?: boolean;
}

export default function Tag({ tag, color, description, skipMargin }: Props) {
  const { getTagById } = useDefinitions();
  const fullTag = getTagById(tag);

  const displayColor = TAG_COLORS.includes(fullTag?.color as RadixColor)
    ? fullTag?.color
    : "violet";

  return (
    <Badge label={tag} color={color ?? displayColor} variant="soft" mr="2" />
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
