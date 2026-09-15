import React from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Flex } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/ui/Badge";
import { RadixColor } from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";

export const TAG_COLORS = [
  "blue",
  "teal",
  "pink",
  "orange",
  "lime",
  "gray",
  "gold",
] as const;

export type TagProps = {
  tag: string;
  color?: RadixColor;
  description?: string;
  skipMargin?: boolean;
  variant?: "badge" | "dot";
  maxChars?: number;
  maxWidth?: number;
  // Overrides the default text label; LinkedTag uses this to inject a link.
  label?: React.ReactElement | string;
} & MarginProps;

export default function Tag({
  tag,
  color,
  description,
  skipMargin,
  variant = "badge",
  maxChars,
  maxWidth = 200,
  label,
}: TagProps) {
  const { getTagById } = useDefinitions();
  const fullTag = getTagById(tag);
  const desc = description ?? fullTag?.description ?? "";
  // Suppressed when a label is provided so wrappers can own hover affordance.
  const displayTitle = label ? undefined : tag + (desc ? `\n\n${desc}` : "");
  const tagColor = (color ?? fullTag?.color ?? "blue") as RadixColor;
  const content = label ?? tag;

  const truncate = maxChars != null && tag.length > maxChars;
  const displayLabel = truncate ? `${tag.slice(0, maxChars)}…` : tag;
  const badgeStyle =
    truncate || maxChars != null
      ? {
          maxWidth: "100%",
          minWidth: 0,
          overflow: "hidden" as const,
          textOverflow: "ellipsis" as const,
        }
      : undefined;

  if (variant === "dot") {
    const dotMark = (
      <Flex
        gap="2"
        align="center"
        title={truncate ? tag : displayTitle}
        mr={skipMargin ? undefined : "2"}
        mb={skipMargin ? undefined : "1"}
        style={maxChars != null ? badgeStyle : { maxWidth, overflow: "hidden" }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 10,
            background: `var(--${tagColor}-10)`,
            flexShrink: 0,
          }}
        />
        <div
          style={
            maxChars != null
              ? { overflow: "hidden", textOverflow: "ellipsis" }
              : {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }
          }
        >
          {maxChars != null ? displayLabel : content}
        </div>
      </Flex>
    );
    return truncate ? (
      <Tooltip body={tag} flipTheme={false}>
        {dotMark}
      </Tooltip>
    ) : (
      dotMark
    );
  }

  const badge = (
    <Badge
      title={truncate ? undefined : displayTitle}
      label={maxChars != null ? displayLabel : content}
      color={tagColor}
      variant="soft"
      className={maxChars != null ? undefined : "text-ellipsis d-inline-block"}
      style={maxChars != null ? badgeStyle : { maxWidth }}
      mr={skipMargin ? undefined : "2"}
      mb={skipMargin ? undefined : "1"}
    />
  );
  return truncate ? (
    <Tooltip body={tag} flipTheme={false}>
      {badge}
    </Tooltip>
  ) : (
    badge
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
