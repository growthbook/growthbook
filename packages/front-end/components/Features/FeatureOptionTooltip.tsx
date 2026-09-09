import React from "react";
import { Flex } from "@radix-ui/themes";
import { FaExclamationCircle, FaQuestion } from "react-icons/fa";
import {
  FaRegCircleCheck,
  FaRegCircleQuestion,
  FaRegCircleXmark,
} from "react-icons/fa6";
import { FeatureValueType } from "shared/types/feature";
import { featureStatusColors } from "@/components/Features/FeaturesOverview";
import FeatureValueTypeDisplay from "@/components/Features/FeatureValueTypeDisplay";
import { PrerequisiteStateResult } from "@/hooks/usePrerequisiteStates";
import Text from "@/ui/Text";
import {
  OptionContext,
  OptionPopover,
  OptionTooltipDescription,
  OptionTooltipProjectsRow,
  OptionTooltipRow,
  OptionTooltipSection,
  OptionTooltipShell,
  OptionTooltipTags,
} from "@/components/Features/OptionTooltipShell";

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
  valueType?: FeatureValueType;
  configBackingKey?: string | null;
  projectName?: string | null;
  targetingProjectNames?: string[];
  targetingAllProjects?: boolean;
  tags?: string[];
  description?: string;
  states?: Record<string, PrerequisiteStateResult>;
}

function getProjectNames(option: FeatureOptionForTooltip) {
  const names = [
    option.projectName || "No Project",
    ...(option.targetingProjectNames ?? []),
  ];
  if (option.targetingAllProjects) names.push("All Projects");
  return names;
}

export function FeatureOptionTooltipContent({
  option,
  environments = [],
}: {
  option: FeatureOptionForTooltip;
  environments?: string[];
}) {
  return (
    <OptionTooltipShell href={`/features/${option.value}`} title={option.label}>
      <OptionTooltipRow label="Type:">
        {option.valueType ? (
          <FeatureValueTypeDisplay
            valueType={option.valueType}
            configBackingKey={option.configBackingKey}
          />
        ) : (
          "unknown"
        )}
      </OptionTooltipRow>
      <OptionTooltipProjectsRow names={getProjectNames(option)} />
      <OptionTooltipTags tags={option.tags} />
      {option.states && environments.length > 0 && (
        <OptionTooltipSection label="Environments:">
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
        </OptionTooltipSection>
      )}
      <OptionTooltipDescription description={option.description} />
    </OptionTooltipShell>
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
  context?: OptionContext;
  children: React.ReactNode;
}) {
  return (
    <OptionPopover
      context={context}
      content={
        <FeatureOptionTooltipContent
          option={option}
          environments={environments}
        />
      }
    >
      {children}
    </OptionPopover>
  );
}
