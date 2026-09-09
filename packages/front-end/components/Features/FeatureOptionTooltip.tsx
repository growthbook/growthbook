import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { FaExclamationCircle, FaQuestion } from "react-icons/fa";
import {
  FaRegCircleCheck,
  FaRegCircleQuestion,
  FaRegCircleXmark,
} from "react-icons/fa6";
import { OptionTooltipDescription } from "@/components/Features/AttributeOptionTooltip";
import { featureStatusColors } from "@/components/Features/FeaturesOverview";
import SortedTags from "@/components/Tags/SortedTags";
import { PrerequisiteStateResult } from "@/hooks/usePrerequisiteStates";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";

function getStateDisplay(state?: PrerequisiteStateResult) {
  if (!state) {
    return {
      icon: <FaQuestion style={{ color: featureStatusColors.offMuted }} />,
      label: "Unknown",
    };
  }
  if (state.state === "cyclic") {
    return {
      icon: (
        <FaExclamationCircle style={{ color: featureStatusColors.danger }} />
      ),
      label: "Cyclic dependency",
    };
  }
  if (state.state === "conditional") {
    return {
      icon: (
        <FaRegCircleQuestion style={{ color: featureStatusColors.warning }} />
      ),
      label: "Schrödinger state",
    };
  }
  if (state.value === null) {
    return {
      icon: (
        <FaRegCircleXmark style={{ color: featureStatusColors.offMuted }} />
      ),
      label: "Not live",
    };
  }
  return {
    icon: <FaRegCircleCheck style={{ color: featureStatusColors.on }} />,
    label: "Live",
  };
}

export interface FeatureOptionForTooltip {
  label: string;
  value: string;
  valueType?: string;
  projectName?: string | null;
  targetingProjectNames?: string[];
  targetingAllProjects?: boolean;
  tags?: string[];
  description?: string;
  states?: Record<string, PrerequisiteStateResult>;
}

function getProjectsLabel(option: FeatureOptionForTooltip) {
  const names = [
    option.projectName || "No Project",
    ...(option.targetingProjectNames ?? []),
  ];
  if (option.targetingAllProjects) names.push("All Projects");
  return names.join(", ");
}

export function FeatureOptionTooltipContent({
  option,
  environments = [],
}: {
  option: FeatureOptionForTooltip;
  environments?: string[];
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
      {option.states && environments.length > 0 && (
        <div>
          <Text size="sm" as="div" weight="semibold">
            Environments:
          </Text>
          <Flex direction="column" gap="1">
            {environments.map((env) => {
              const { icon, label } = getStateDisplay(option.states?.[env]);
              return (
                <Flex key={env} align="center" gap="2">
                  {icon}
                  <Text size="sm" overflowWrap="anywhere">
                    {env}
                  </Text>
                  <Text size="sm" color="text-low">
                    {label}
                  </Text>
                </Flex>
              );
            })}
          </Flex>
        </div>
      )}
      <OptionTooltipDescription description={option.description} />
    </Flex>
  );
}

export function FeatureOptionWithTooltip({
  option,
  environments,
  context = "menu",
  children,
}: {
  option: FeatureOptionForTooltip;
  environments?: string[];
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
            display: isValue ? "flex" : "block",
            alignItems: isValue ? "center" : undefined,
            minWidth: isValue ? undefined : 80,
            maxWidth: 400,
          }}
        >
          {children}
        </div>
      }
      content={
        <FeatureOptionTooltipContent
          option={option}
          environments={environments}
        />
      }
    />
  );
}
