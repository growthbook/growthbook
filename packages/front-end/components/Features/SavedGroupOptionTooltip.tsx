import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import { SavedGroupForDefinitions } from "shared/types/saved-group";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import { AttributeOptionProjectsLabel } from "./AttributeOptionTooltip";
import {
  OptionContext,
  OptionLabel,
  OptionMenuRow,
  OptionPopover,
  OptionTooltipDescription,
  OptionTooltipProjectsRow,
  OptionTooltipRow,
  OptionTooltipShell,
  useProjectNames,
} from "./OptionTooltipShell";

/** True for a remote group used in a rule on another attribute. */
function isDerivedUse(
  group: SavedGroupForDefinitions,
  conditionAttribute?: string,
): boolean {
  return (
    group.type === "remote" &&
    !!conditionAttribute &&
    group.attributeKey !== conditionAttribute
  );
}

export function SavedGroupOptionTooltipContent({
  group,
  conditionAttribute,
}: {
  group: SavedGroupForDefinitions;
  /** The attribute of the rule the group is picked for. */
  conditionAttribute?: string;
}) {
  const names = useProjectNames(group.projects);
  return (
    <OptionTooltipShell
      href={`/saved-groups/${group.id}`}
      title={group.groupName}
    >
      <OptionTooltipRow label="Type:">
        {group.type === "list"
          ? "ID List"
          : group.type === "remote"
            ? "Remote Group"
            : "Condition Group"}
      </OptionTooltipRow>
      {group.type !== "condition" && group.attributeKey && (
        <OptionTooltipRow label="Attribute:">
          {group.attributeKey}
        </OptionTooltipRow>
      )}
      {isDerivedUse(group, conditionAttribute) && (
        <OptionTooltipRow label="Compared to:">
          {conditionAttribute}
        </OptionTooltipRow>
      )}
      <OptionTooltipProjectsRow names={names} />
      <OptionTooltipDescription description={group.description} />
    </OptionTooltipShell>
  );
}

export function SavedGroupOptionWithTooltip({
  groupId,
  context = "menu",
  conditionAttribute,
  children,
}: {
  groupId: string;
  context?: OptionContext;
  conditionAttribute?: string;
  children: React.ReactNode;
}) {
  const { getSavedGroupById } = useDefinitions();
  const group = getSavedGroupById(groupId);
  if (!group) return <>{children}</>;
  return (
    <OptionPopover
      context={context}
      content={
        <SavedGroupOptionTooltipContent
          group={group}
          conditionAttribute={conditionAttribute}
        />
      }
    >
      {children}
    </OptionPopover>
  );
}

function SavedGroupOptionLabel({
  option,
  context,
  conditionAttribute,
}: {
  option: { label: string; value: string };
  context: OptionContext;
  conditionAttribute?: string;
}) {
  const { getSavedGroupById } = useDefinitions();
  const group = getSavedGroupById(option.value);
  if (!group) return <Text size="md">{option.label}</Text>;

  // Outside the truncated label, so it is always visible.
  const sourceAttribute =
    group.type === "remote" && isDerivedUse(group, conditionAttribute) ? (
      <Text size="sm" color="text-low" whiteSpace="nowrap">
        ({group.attributeKey} IDs)
      </Text>
    ) : null;

  return (
    <SavedGroupOptionWithTooltip
      groupId={group.id}
      context={context}
      conditionAttribute={conditionAttribute}
    >
      {context === "menu" ? (
        <OptionMenuRow
          label={option.label}
          right={
            <>
              {sourceAttribute}
              <AttributeOptionProjectsLabel projects={group.projects} />
            </>
          }
        />
      ) : (
        // The name shrinks before the suffix, which is the only sign that the
        // group's IDs belong to another attribute
        <Flex align="center" gap="2" minWidth="0">
          <Box flexShrink="1" minWidth="0">
            <OptionLabel
              label={option.label}
              maxWidth={sourceAttribute ? "100%" : undefined}
            />
          </Box>
          {sourceAttribute && <Box flexShrink="0">{sourceAttribute}</Box>}
        </Flex>
      )}
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

/**
 * Like `formatSavedGroupOptionLabel`, for a rule on `conditionAttribute`:
 * remote groups on another attribute show that attribute.
 */
export function formatSavedGroupOptionLabelFor(conditionAttribute: string) {
  return function formatLabel(
    o: { label: string; value: string },
    meta: { context: string },
  ) {
    return (
      <SavedGroupOptionLabel
        option={o}
        context={meta.context === "value" ? "value" : "menu"}
        conditionAttribute={conditionAttribute}
      />
    );
  };
}
