import React from "react";
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

export function SavedGroupOptionTooltipContent({
  group,
}: {
  group: SavedGroupForDefinitions;
}) {
  const names = useProjectNames(group.projects);
  return (
    <OptionTooltipShell
      href={`/saved-groups/${group.id}`}
      title={group.groupName}
    >
      <OptionTooltipRow label="Type:">
        {group.type === "list" ? "ID List" : "Condition Group"}
      </OptionTooltipRow>
      {group.type === "list" && group.attributeKey && (
        <OptionTooltipRow label="Attribute:">
          {group.attributeKey}
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
  children,
}: {
  groupId: string;
  context?: OptionContext;
  children: React.ReactNode;
}) {
  const { getSavedGroupById } = useDefinitions();
  const group = getSavedGroupById(groupId);
  if (!group) return <>{children}</>;
  return (
    <OptionPopover
      context={context}
      content={<SavedGroupOptionTooltipContent group={group} />}
    >
      {children}
    </OptionPopover>
  );
}

function SavedGroupOptionLabel({
  option,
  context,
}: {
  option: { label: string; value: string };
  context: OptionContext;
}) {
  const { getSavedGroupById } = useDefinitions();
  const group = getSavedGroupById(option.value);
  if (!group) return <Text size="md">{option.label}</Text>;

  return (
    <SavedGroupOptionWithTooltip groupId={group.id} context={context}>
      {context === "menu" ? (
        <OptionMenuRow
          label={option.label}
          right={<AttributeOptionProjectsLabel projects={group.projects} />}
        />
      ) : (
        <OptionLabel label={option.label} />
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
