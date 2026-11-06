import { ReactNode } from "react";
import {
  ApiContextualBanditInterface,
  ContextualBanditRefRule,
} from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { getConfigBackingKey, getFeatureBaseConfigKey } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { hasTargetingConfigured } from "shared/experiments";
import { useContextualBandits } from "@/hooks/useContextualBandits";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import ValueDisplay, {
  LISTED_VALUE_STYLE,
} from "@/components/Features/ValueDisplay";
import RuleField from "@/components/Features/RuleField";
import RolloutRow from "@/components/Features/RolloutRow";
import ConfigBackedSummary from "@/components/Features/ConfigBackedSummary";
import { ValueDiffProvider } from "@/components/Features/ValueDiffContext";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import RuleVariationsTable from "@/components/Features/RuleVariationsTable";

export function isContextualBanditRefRuleSkipped(
  cb: ApiContextualBanditInterface,
  isDraft: boolean,
): boolean {
  if (cb.archived) return true;
  if (cb.status === "stopped") return true;
  if (cb.status === "draft") return !isDraft;
  return false;
}

// Why a Contextual Bandit rule serves nothing, or null while it serves.
export function contextualBanditSkipReason(
  cb: ApiContextualBanditInterface,
  isDraft: boolean,
): ReactNode {
  const view = (
    <Link href={`/contextual-bandit/${cb.id}`}>View Contextual Bandit</Link>
  );
  if (cb.archived) return <>This Contextual Bandit is archived. {view}</>;
  if (cb.status === "stopped") {
    return <>This Contextual Bandit is stopped. {view}</>;
  }
  if (cb.status === "draft" && !isDraft) {
    return (
      <>
        This Contextual Bandit is in a <strong>draft</strong> state and has not
        been started yet.
      </>
    );
  }
  return null;
}

export default function ContextualBanditRefSummary({
  rule,
  feature,
  environment,
}: {
  rule: ContextualBanditRefRule;
  feature: FeatureInterface;
  environment?: string;
}) {
  const { contextualBanditsMap, loading } = useContextualBandits();
  const cb: ApiContextualBanditInterface | undefined =
    contextualBanditsMap?.get(rule.contextualBanditId);
  const type = feature.valueType;

  if (loading) return null;

  if (!cb) {
    return (
      <Callout status="error">
        The Contextual Bandit <code>{rule.contextualBanditId}</code> could not
        be found.
      </Callout>
    );
  }

  // The card's ribbon says why these serve nothing.
  if (cb.archived || cb.status === "stopped") return null;

  const defaultConfigKey = getFeatureBaseConfigKey(feature);
  const variationValue = (value: string) => {
    const configKey =
      defaultConfigKey !== null
        ? (getConfigBackingKey(value) ?? defaultConfigKey)
        : null;
    return configKey !== null ? (
      <ConfigBackedSummary
        label={null}
        value={value}
        configKey={configKey}
        feature={feature}
        sparse
        environment={environment}
      />
    ) : (
      <ValueDisplay value={value} type={type} fullStyle={LISTED_VALUE_STYLE} />
    );
  };

  return (
    <Box>
      {hasTargetingConfigured({
        condition: cb.condition,
        savedGroups: cb.savedGroups,
        prerequisites: cb.prerequisites,
      }) && (
        <RuleField label="Targeting">
          <ConditionDisplay
            condition={cb.condition || ""}
            savedGroups={cb.savedGroups}
            prerequisites={cb.prerequisites}
          />
        </RuleField>
      )}

      <RuleField label="Split by">
        <AttributeBadge attributeId={cb.hashAttribute || "id"} />
      </RuleField>

      <RolloutRow coverage={cb.coverage ?? 1} />

      {cb.contextualAttributes.length > 0 && (
        <RuleField label="Context">
          <Flex gap="2" wrap="wrap" align="center">
            {cb.contextualAttributes.map((a) => (
              <AttributeBadge key={a} attributeId={a} />
            ))}
          </Flex>
        </RuleField>
      )}

      <RuleField label="Serve" mb="0" align="start">
        <Box>
          <ValueDiffProvider>
            <RuleVariationsTable
              rows={cb.variations.map((v) => {
                const ruleVariation = rule.variations.find(
                  (rv) => rv.variationId === v.id,
                );
                return {
                  key: v.id,
                  name: v.name || v.key,
                  value: ruleVariation ? (
                    variationValue(ruleVariation.value)
                  ) : (
                    <em>not set</em>
                  ),
                };
              })}
            />
          </ValueDiffProvider>
        </Box>
      </RuleField>
    </Box>
  );
}
