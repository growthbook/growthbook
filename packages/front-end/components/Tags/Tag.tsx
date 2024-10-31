import React from "react";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import {
  gray,
  gold,
  bronze,
  brown,
  yellow,
  amber,
  orange,
  tomato,
  red,
  ruby,
  crimson,
  pink,
  plum,
  purple,
  violet,
  iris,
  indigo,
  blue,
  cyan,
  teal,
  jade,
  green,
  grass,
  lime,
  mint,
  sky,
} from "@radix-ui/colors";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/components/Radix/Badge";

export const TAG_COLORS = [
  "blue",
  "teal",
  "pink",
  "orange",
  "lime",
  "gray",
  "gold",
] as const;

const TAG_COLORS_MAP = {
  gray: gray.gray11,
  gold: gold.gold11,
  bronze: bronze.bronze11,
  brown: brown.brown11,
  yellow: yellow.yellow11,
  amber: amber.amber11,
  orange: orange.orange11,
  tomato: tomato.tomato11,
  red: red.red11,
  ruby: ruby.ruby11,
  crimson: crimson.crimson11,
  pink: pink.pink11,
  plum: plum.plum11,
  purple: purple.purple11,
  violet: violet.violet11,
  iris: iris.iris11,
  indigo: indigo.indigo11,
  blue: blue.blue11,
  cyan: cyan.cyan11,
  teal: teal.teal11,
  jade: jade.jade11,
  green: green.green11,
  grass: grass.grass11,
  lime: lime.lime11,
  mint: mint.mint11,
  sky: sky.sky11,
};

export type TagColor = typeof TAG_COLORS[number];
const isTagColor = (x: TagColor | string): x is TagColor =>
  TAG_COLORS.includes(x as TagColor);

type Props = {
  tag: string;
  color?: string;
  description?: string;
  skipMargin?: boolean;
} & MarginProps;

// Function to convert hex to RGB
function hexToRgb(hex) {
  hex = hex.replace(/^#/, "");
  const bigint = parseInt(hex, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return { r, g, b };
}

// Function to calculate the Euclidean distance between two colors
function colorDistance(color1, color2) {
  return Math.sqrt(
    Math.pow(color1.r - color2.r, 2) +
      Math.pow(color1.g - color2.g, 2) +
      Math.pow(color1.b - color2.b, 2)
  );
}

// Function to find the closest color in the object
function findClosestColorName(targetHex, colorsObject) {
  const targetRgb = hexToRgb(targetHex);
  let closestColorName;
  let smallestDistance = Infinity;

  for (const [colorName, hexColor] of Object.entries(colorsObject)) {
    const currentRgb = hexToRgb(hexColor);
    const distance = colorDistance(targetRgb, currentRgb);

    if (distance < smallestDistance) {
      smallestDistance = distance;
      closestColorName = colorName;
    }
  }

  console.log({ targetHex, closestColorName });
  return closestColorName;
}

export default function Tag({ tag, color, description, skipMargin }: Props) {
  const { getTagById } = useDefinitions();
  const fullTag = getTagById(tag);

  const displayTitle = description ?? fullTag?.description ?? "";

  const tagColor = color ?? fullTag?.color ?? "blue";
  // If a tag is still using a hex code color, we'll default to blue
  const displayColor = isTagColor(tagColor)
    ? tagColor
    : findClosestColorName(tagColor, TAG_COLORS_MAP);

  return (
    <Badge
      title={displayTitle}
      label={tag}
      color={displayColor}
      variant="soft"
      ml={skipMargin ? undefined : "2"}
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
