import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import SortedTags from "@/components/Tags/SortedTags";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";

export interface FeatureOptionForTooltip {
  label: string;
  value: string;
  valueType?: string;
  projectName?: string | null;
  targetingProjectNames?: string[];
  targetingAllProjects?: boolean;
  tags?: string[];
  description?: string;
}

function getProjectsLabel(option: FeatureOptionForTooltip) {
  const names = [
    option.projectName || "No project",
    ...(option.targetingProjectNames ?? []),
  ];
  if (option.targetingAllProjects) names.push("all projects");
  return names.join(", ");
}

export function FeatureOptionTooltipContent({
  option,
}: {
  option: FeatureOptionForTooltip;
}) {
  const multipleProjects =
    !!option.targetingAllProjects ||
    (option.targetingProjectNames?.length ?? 0) > 0;
  return (
    <Flex direction="column" gap="2" style={{ minWidth: 0, maxWidth: 280 }}>
      <Link
        href={`/features/${option.value}`}
        target="_blank"
        weight="bold"
        size="md"
      >
        <span style={{ overflowWrap: "anywhere" }} className="mr-1">
          {option.label}
        </span>
        <PiArrowSquareOut />
      </Link>
      {option.valueType && (
        <Text size="sm" as="div">
          <Text size="sm" as="span" weight="semibold">
            Type:{" "}
          </Text>
          {option.valueType}
        </Text>
      )}
      <Text size="sm" as="div">
        <Text size="sm" as="span" weight="semibold">
          {multipleProjects ? "Projects:" : "Project:"}{" "}
        </Text>
        {getProjectsLabel(option)}
      </Text>
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

export function FeatureOptionWithTooltip({
  option,
  context = "menu",
  children,
}: {
  option: FeatureOptionForTooltip;
  context?: "menu" | "value";
  children: React.ReactNode;
}) {
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
            display: isValue ? "inline-block" : "block",
            minWidth: isValue ? undefined : 80,
            maxWidth: 400,
          }}
        >
          {children}
        </div>
      }
      content={<FeatureOptionTooltipContent option={option} />}
    />
  );
}
