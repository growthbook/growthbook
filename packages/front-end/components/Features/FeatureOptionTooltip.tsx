import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FeatureValueType } from "shared/types/feature";
import FeatureValueTypeDisplay from "@/components/Features/FeatureValueTypeDisplay";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
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

const ENV_COL_W = 80;

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
          <Box style={{ overflowX: "auto" }}>
            <Flex direction="column" style={{ minWidth: "max-content" }}>
              <Flex align="center">
                {environments.map((env) => (
                  <Box
                    key={env}
                    style={{
                      width: ENV_COL_W,
                      flexShrink: 0,
                      textAlign: "center",
                    }}
                  >
                    <Text size="sm" color="text-mid">
                      <OverflowText maxWidth={ENV_COL_W}>{env}</OverflowText>
                    </Text>
                  </Box>
                ))}
              </Flex>
              <Flex align="center">
                <PrerequisiteStatesCols
                  prereqStates={option.states}
                  envs={environments}
                  colWidth={ENV_COL_W}
                />
              </Flex>
            </Flex>
          </Box>
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
