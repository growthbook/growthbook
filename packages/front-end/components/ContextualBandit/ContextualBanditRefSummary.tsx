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
import Badge from "@/ui/Badge";
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import Text from "@/ui/Text";
import ValueDisplay from "@/components/Features/ValueDisplay";
import VariationLabel from "@/ui/VariationLabel";
import ConfigBackedSummary from "@/components/Features/ConfigBackedSummary";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

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
        <Flex direction="row" gap="2" mb="3">
          <Text weight="medium">IF</Text>
          <Box>
            <ConditionDisplay
              condition={cb.condition || ""}
              savedGroups={cb.savedGroups}
              prerequisites={cb.prerequisites}
            />
          </Box>
        </Flex>
      )}

      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">SPLIT</Text>
        by
        <AttributeBadge attributeId={cb.hashAttribute || "id"} />
      </Flex>

      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">INCLUDE</Text>
        <Badge
          color="gray"
          label={
            <Text color="text-high">
              {percentFormatter.format(cb.coverage ?? 1)}
            </Text>
          }
        />
        of units in the Contextual Bandit
      </Flex>

      {cb.contextualAttributes.length > 0 && (
        <Flex direction="row" gap="2" mb="3" wrap="wrap" align="center">
          <Text weight="medium">CONTEXT</Text>
          {cb.contextualAttributes.map((a) => (
            <AttributeBadge key={a} attributeId={a} />
          ))}
        </Flex>
      )}

      <Flex gap="2">
        <Text weight="medium">SERVE</Text>
      </Flex>

      <Box
        mt="3"
        px="3"
        style={{
          border: "1px solid var(--gray-a5)",
          borderRadius: "var(--radius-2)",
        }}
      >
        <Table>
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
                    <VariationLabel number={i} name={v.name || v.key} />
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
      </Box>
    </Box>
  );
}
