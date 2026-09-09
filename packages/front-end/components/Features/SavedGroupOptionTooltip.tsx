import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { SavedGroupForDefinitions } from "shared/types/saved-group";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import {
  AttributeOptionProjectsLabel,
  OptionTooltipDescription,
} from "./AttributeOptionTooltip";

export function SavedGroupOptionTooltipContent({
  group,
}: {
  group: SavedGroupForDefinitions;
}) {
  const { getProjectById } = useDefinitions();
  return (
    <Flex direction="column" gap="2" style={{ minWidth: 0, maxWidth: 280 }}>
      <Link
        href={`/saved-groups/${group.id}`}
        target="_blank"
        weight="bold"
        size="md"
      >
        <span style={{ overflowWrap: "anywhere" }} className="mr-1">
          {group.groupName}
        </span>
        <PiArrowSquareOut />
      </Link>
      <Text size="sm" as="div">
        <Text size="sm" as="span" weight="semibold">
          Type:{" "}
        </Text>
        {group.type === "list" ? "ID List" : "Condition Group"}
      </Text>
      {group.type === "list" && group.attributeKey && (
        <Text size="sm" as="div">
          <Text size="sm" as="span" weight="semibold">
            Attribute:{" "}
          </Text>
          {group.attributeKey}
        </Text>
      )}
      <Text size="sm" as="div">
        <Text size="sm" as="span" weight="semibold">
          {group.projects?.length === 1 ? "Project:" : "Projects:"}{" "}
        </Text>
        {group.projects?.length
          ? group.projects
              .map((id) => getProjectById(id)?.name || id)
              .join(", ")
          : "All Projects"}
      </Text>
      <OptionTooltipDescription description={group.description} />
    </Flex>
  );
}

export function SavedGroupOptionWithTooltip({
  groupId,
  context = "menu",
  children,
}: {
  groupId: string;
  context?: "menu" | "value";
  children: React.ReactNode;
}) {
  const { getSavedGroupById } = useDefinitions();
  const group = getSavedGroupById(groupId);
  if (!group) return <>{children}</>;
  const isValue = context === "value";
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
            display: isValue ? "flex" : "block",
            alignItems: isValue ? "center" : undefined,
            minWidth: isValue ? undefined : 80,
            maxWidth: 400,
          }}
        >
          {children}
        </div>
      }
      content={<SavedGroupOptionTooltipContent group={group} />}
    />
  );
}

function SavedGroupOptionLabel({
  option,
  context,
}: {
  option: { label: string; value: string };
  context: "menu" | "value";
}) {
  const { getSavedGroupById } = useDefinitions();
  const group = getSavedGroupById(option.value);
  if (!group) return <>{option.label}</>;

  if (context === "menu") {
    return (
      <SavedGroupOptionWithTooltip groupId={group.id} context="menu">
        <Flex align="center" gap="3">
          <span>{option.label}</span>
          <AttributeOptionProjectsLabel projects={group.projects} />
        </Flex>
      </SavedGroupOptionWithTooltip>
    );
  }

  return (
    <SavedGroupOptionWithTooltip groupId={group.id} context="value">
      <span
        style={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "200px",
        }}
      >
        {option.label}
      </span>
    </SavedGroupOptionWithTooltip>
  );
}

export function formatSavedGroupOptionLabel(
  o: { label: string; value: string },
  meta: { context: string },
) {
  return (
    <SavedGroupOptionLabel
      option={o}
      context={meta.context === "value" ? "value" : "menu"}
    />
  );
}
