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
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import ValueDisplay, {
  LISTED_VALUE_STYLE,
} from "@/components/Features/ValueDisplay";
import RuleField from "@/components/Features/RuleField";
import RolloutRow from "@/components/Features/RolloutRow";
import VariationNumber from "@/ui/VariationNumber";
import ConfigBackedSummary from "@/components/Features/ConfigBackedSummary";
import { ValueDiffProvider } from "@/components/Features/ValueDiffContext";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import Tooltip from "@/ui/Tooltip";
import variationsTableStyles from "@/components/Features/RuleVariationsTable.module.scss";

export function isContextualBanditRefRuleSkipped(
  cb: ApiContextualBanditInterface,
  isDraft: boolean,
): boolean {
  if (cb.archived) return true;
  if (cb.status === "stopped") return true;
  if (cb.status === "draft") return !isDraft;
  return false;
}

export default function ContextualBanditRefSummary({
  rule,
  feature,
  environment,
  isDraft,
}: {
  rule: ContextualBanditRefRule;
  feature: FeatureInterface;
  environment?: string;
  isDraft?: boolean;
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

  const detailHref = `/contextual-bandit/${cb.id}`;

  if (cb.archived) {
    return (
      <Callout status="info">
        This Contextual Bandit is archived and will be skipped.{" "}
        <Link href={detailHref}>View Contextual Bandit</Link>
      </Callout>
    );
  }

  if (cb.status === "stopped") {
    return (
      <Callout status="info">
        This Contextual Bandit is stopped and will be skipped.{" "}
        <Link href={detailHref}>View Contextual Bandit</Link>
      </Callout>
    );
  }

  return (
    <Box>
      {cb.status === "draft" && !isDraft && (
        <Callout status="warning" mb="3">
          This Contextual Bandit is in a <strong>draft</strong> state and has
          not been started yet. This rule will be skipped.
        </Callout>
      )}
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
            <Table variant="surface" className={variationsTableStyles.table}>
              <TableBody>
                {cb.variations.map((v, i) => {
                  const ruleVariation = rule.variations.find(
                    (rv) => rv.variationId === v.id,
                  );
                  return (
                    <TableRow
                      key={v.id}
                      style={{ color: "var(--color-text-high)" }}
                    >
                      <TableCell style={{ whiteSpace: "nowrap" }}>
                        <Tooltip content={v.name || v.key}>
                          <Box className={variationsTableStyles.marker}>
                            <VariationNumber number={i} />
                          </Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell width="100%">
                        {ruleVariation ? (
                          (() => {
                            const defaultConfigKey =
                              getFeatureBaseConfigKey(feature);
                            const configKey =
                              defaultConfigKey !== null
                                ? (getConfigBackingKey(ruleVariation.value) ??
                                  defaultConfigKey)
                                : null;
                            return configKey !== null ? (
                              <ConfigBackedSummary
                                label={null}
                                value={ruleVariation.value}
                                configKey={configKey}
                                feature={feature}
                                sparse={defaultConfigKey !== null}
                                environment={environment}
                              />
                            ) : (
                              <ValueDisplay
                                value={ruleVariation.value}
                                type={type}
                                fullStyle={LISTED_VALUE_STYLE}
                              />
                            );
                          })()
                        ) : (
                          <em>not set</em>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ValueDiffProvider>
        </Box>
      </RuleField>
    </Box>
  );
}
