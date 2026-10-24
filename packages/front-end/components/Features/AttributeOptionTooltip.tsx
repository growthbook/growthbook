import React from "react";
import Text from "@/ui/Text";
import {
  OptionContext,
  OptionLabel,
  OptionMenuRow,
  OptionPopover,
  OptionProjectsLabel,
  OptionTooltipDescription,
  OptionTooltipProjectsRow,
  OptionTooltipRow,
  OptionTooltipShell,
  OptionTooltipTags,
  useProjectNames,
} from "@/components/Features/OptionTooltipShell";

export interface AttributeOptionForTooltip {
  label: string;
  value: string;
  description?: string;
  tags?: string[];
  datatype?: string;
  hashAttribute?: boolean;
  projects?: string[];
}

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
  const names = useProjectNames(option.projects);
  return (
    <OptionTooltipShell
      href={`/attributes/${option.value}`}
      title={option.label}
    >
      <OptionTooltipRow label="Type:">
        {option.datatype ?? "unknown"}
      </OptionTooltipRow>
      <OptionTooltipProjectsRow names={names} />
      {option.hashAttribute === true && (
        <Text size="sm" as="div" weight="semibold">
          Identifier
        </Text>
      )}
      <OptionTooltipTags tags={option.tags} />
      <OptionTooltipDescription description={option.description} />
    </OptionTooltipShell>
  );
}

export function AttributeOptionProjectsLabel({
  projects,
}: {
  projects?: string[];
}) {
  const names = useProjectNames(projects);
  return <OptionProjectsLabel names={names} />;
}

export function formatAttributeOptionLabel(
  o: { label: string },
  meta: { context: string },
) {
  const option = o as AttributeOptionForTooltip;
  const context: OptionContext = meta.context === "value" ? "value" : "menu";
  return (
    <AttributeOptionWithTooltip option={option} context={context}>
      {context === "menu" ? (
        <OptionMenuRow
          label={o.label}
          right={<AttributeOptionProjectsLabel projects={option.projects} />}
        />
      ) : (
        <OptionLabel label={o.label} />
      )}
    </AttributeOptionWithTooltip>
  );
}

export function AttributeOptionWithTooltip({
  option,
  context = "menu",
  children,
}: {
  option: AttributeOptionForTooltip;
  context?: OptionContext;
  children: React.ReactNode;
}) {
  return (
    <OptionPopover
      context={context}
      content={<AttributeOptionTooltipContent option={option} />}
    >
      {children}
    </OptionPopover>
  );
}
