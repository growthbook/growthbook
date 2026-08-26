import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import { useDefinitions } from "@/services/DefinitionsContext";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import SortedTags from "@/components/Tags/SortedTags";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";

export interface AttributeOptionForTooltip {
  label: string;
  value: string;
  description?: string;
  tags?: string[];
  datatype?: string;
  hashAttribute?: boolean;
  // Project ids the attribute is scoped to; empty/undefined = all projects.
  projects?: string[];
}

// Shared select-option mapper so every attribute picker feeds the tooltip
// and project annotation the same metadata.
export function toAttributeOption(s: {
  property: string;
  description?: string;
  tags?: string[];
  datatype?: string;
  hashAttribute?: boolean;
  projects?: string[];
}): AttributeOptionForTooltip {
  return {
    label: s.property,
    value: s.property,
    description: s.description,
    tags: s.tags,
    datatype: s.datatype,
    hashAttribute: s.hashAttribute,
    projects: s.projects,
  };
}

export function AttributeOptionTooltipContent({
  option,
}: {
  option: AttributeOptionForTooltip;
}) {
  const { getProjectById } = useDefinitions();
  return (
    <Flex direction="column" gap="2" style={{ minWidth: 0, maxWidth: 280 }}>
      <Link
        href={`/attributes/${option.value}`}
        target="_blank"
        weight="bold"
        size="md"
      >
        <span style={{ overflowWrap: "anywhere" }} className="mr-1">
          {option.label}
        </span>
        <PiArrowSquareOut />
      </Link>
      <Text size="sm" as="div">
        <Text size="sm" as="span" weight="semibold">
          Type:{" "}
        </Text>
        {option.datatype ?? "unknown"}
      </Text>
      <Text size="sm" as="div">
        <Text size="sm" as="span" weight="semibold">
          Projects:{" "}
        </Text>
        {option.projects?.length
          ? option.projects
              .map((id) => getProjectById(id)?.name || id)
              .join(", ")
          : "All Projects"}
      </Text>
      {option.hashAttribute === true && (
        <Text size="sm" as="div" weight="semibold">
          Identifier
        </Text>
      )}
      {option.tags && option.tags.length > 0 && (
        <div>
          <Text size="sm" as="div" weight="semibold">
            Tags:
          </Text>
          <SortedTags
            tags={option.tags}
            shouldShowEllipsis={true}
            showEllipsisAtIndex={20}
            ellipsisFormat={(n) => `+${n}`}
          />
        </div>
      )}
      {option.description && (
        <div>
          <Text size="sm" as="div" weight="semibold">
            Description:
          </Text>
          <Markdown style={{ fontSize: 12 }}>{option.description}</Markdown>
        </div>
      )}
    </Flex>
  );
}

// Right-aligned project annotation for attribute options in dropdown menus,
// mirroring the prerequisite feature selector's "Project: X" display.
export function AttributeOptionProjectsLabel({
  projects,
}: {
  projects?: string[];
}) {
  const { getProjectById } = useDefinitions();
  const names = (projects ?? []).map((id) => getProjectById(id)?.name || id);
  // Unscoped attributes render nothing — the annotation only flags scoped ones.
  if (!names.length) return null;
  // One notch below the smallest design-system text size — it's a secondary
  // annotation inside a menu row.
  return (
    <Flex ml="auto" flexShrink="0" align="center" style={{ fontSize: 11 }}>
      <Text size="inherit">
        <Text size="inherit" color="text-low">
          {names.length > 1 ? "Projects:" : "Project:"}
        </Text>{" "}
        <Text size="inherit" color="text-high">
          <OverflowText maxWidth={150} title={names.join(", ")}>
            {names.join(", ")}
          </OverflowText>
        </Text>
      </Text>
    </Flex>
  );
}

export function AttributeOptionWithTooltip({
  option,
  context = "menu",
  children,
}: {
  option: AttributeOptionForTooltip;
  context?: "menu" | "value";
  children: React.ReactNode;
}) {
  const isValue = context === "value";
  // Hover-mode @/ui/Popover (not the legacy popper Tooltip): it participates
  // in Radix's layer system, so it renders above modal Dialogs where the
  // body-portaled popper does not, and its content stays hoverable (the
  // attribute link is clickable).
  return (
    <Popover
      openOnHover
      anchorOnly
      side={isValue ? "top" : "right"}
      sideOffset={8}
      trigger={
        <div
          style={{
            position: "relative",
            display: isValue ? "inline-block" : "block",
            minWidth: 80,
            maxWidth: 400,
          }}
        >
          {children}
        </div>
      }
      content={<AttributeOptionTooltipContent option={option} />}
    />
  );
}
