import React from "react";
import { Flex } from "@radix-ui/themes";
import { FeatureValueType } from "shared/types/feature";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import FeatureValueTypeDisplay from "@/components/Features/FeatureValueTypeDisplay";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatesCols";
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

function getProjectNames(option: FeatureOptionForTooltip, i18n: I18n) {
  const names = [
    option.projectName || i18n._(msg`No Project`),
    ...(option.targetingProjectNames ?? []),
  ];
  if (option.targetingAllProjects) names.push(i18n._(msg`All Projects`));
  return names;
}

export function FeatureOptionTooltipContent({
  option,
  environments = [],
}: {
  option: FeatureOptionForTooltip;
  environments?: string[];
}) {
  const { t, i18n } = useLingui();
  return (
    <OptionTooltipShell href={`/features/${option.value}`} title={option.label}>
      <OptionTooltipRow label={t`Type:`}>
        {option.valueType ? (
          <FeatureValueTypeDisplay
            valueType={option.valueType}
            configBackingKey={option.configBackingKey}
          />
        ) : (
          t`unknown`
        )}
      </OptionTooltipRow>
      <OptionTooltipProjectsRow names={getProjectNames(option, i18n)} />
      <OptionTooltipTags tags={option.tags} />
      {option.states && environments.length > 0 && (
        <OptionTooltipSection label={t`Environments:`}>
          {environments.map((env) => (
            <Flex key={env} align="center" gap="2">
              <PrerequisiteStatesCols
                prereqStates={option.states}
                envs={[env]}
                colWidth={20}
                compact
              />
              <Text size="sm" overflowWrap="anywhere">
                {env}
              </Text>
            </Flex>
          ))}
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
