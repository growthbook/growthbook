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

// Convert RGB to XYZ
function rgbToXyz({ r, g, b }) {
  // Normalize the RGB values
  r = r / 255;
  g = g / 255;
  b = b / 255;

  // Apply the sRGB companding
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  // Convert to XYZ using the D65 reference white
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) * 100;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) * 100;

  return { x, y, z };
}

// Convert XYZ to CIELAB
function xyzToLab({ x, y, z }) {
  // D65 reference white point
  const refX = 95.047;
  const refY = 100.0;
  const refZ = 108.883;

  x = x / refX;
  y = y / refY;
  z = z / refZ;

  x = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  const l = 116 * y - 16;
  const a = 500 * (x - y);
  const b = 200 * (y - z);

  return { l, a, b };
}

// Calculate Euclidean distance in CIELAB
function labDistance(lab1, lab2) {
  return Math.sqrt(
    Math.pow(lab1.l - lab2.l, 2) +
      Math.pow(lab1.a - lab2.a, 2) +
      Math.pow(lab1.b - lab2.b, 2)
  );
}

// Find the closest color in CIELAB space
function findClosestColorName(targetHex, colorsObject) {
  const targetLab = xyzToLab(rgbToXyz(hexToRgb(targetHex)));
  let closestColorName;
  let smallestDistance = Infinity;

  for (const [colorName, hexColor] of Object.entries(colorsObject)) {
    const currentLab = xyzToLab(rgbToXyz(hexToRgb(hexColor)));
    const distance = labDistance(targetLab, currentLab);

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
  // If a tag is still using a hex code color, we'll find the closest radix color
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
