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
import { getVariationColor } from "@/services/features";
import ValueDisplay from "@/components/Features/ValueDisplay";
import ConfigBackedSummary from "@/components/Features/ConfigBackedSummary";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";

export function isContextualBanditRefRuleSkipped(
  cb: ApiContextualBanditInterface | undefined,
  isDraft: boolean,
): boolean {
  if (!cb) return true;
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
        <Link href={detailHref}>View CB</Link>
      </Callout>
    );
  }

  if (cb.status === "stopped") {
    return (
      <Callout status="info">
        This Contextual Bandit is stopped and will be skipped.{" "}
        <Link href={detailHref}>View CB</Link>
      </Callout>
    );
  }

  const variationWeights = cb.variations.map(
    (v) =>
      cb.variationWeights?.find((w) => w.variationId === v.id)?.weight ?? 0,
  );

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
              {`${Math.round((cb.coverage ?? 1) * 10000) / 100}%`}
            </Text>
          }
        />
        of units in the Contextual Bandit
      </Flex>

      {cb.contextualAttributes.length > 0 && (
        <Flex direction="row" gap="2" mb="3">
          <Text weight="medium">CONTEXT</Text>
          <Text color="text-high">{cb.contextualAttributes.join(", ")}</Text>
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
              const weight = variationWeights[i];
              return (
                <TableRow
                  key={v.id}
                  style={{ color: "var(--color-text-high)" }}
                >
                  <TableCell style={{ whiteSpace: "nowrap" }}>
                    <Flex align="center" gap="2">
                      <span
                        style={{
                          color: getVariationColor(i, true),
                          borderColor: getVariationColor(i, true),
                          fontSize: "14px",
                          width: 20,
                          height: 20,
                          borderRadius: 20,
                          borderWidth: 1,
                          borderStyle: "solid",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {i}
                      </span>
                      <Text weight="medium" whiteSpace="nowrap">
                        {v.name || v.key}
                      </Text>
                    </Flex>
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
                  <TableCell
                    style={{
                      color: "var(--color-text-mid)",
                      textAlign: "right",
                    }}
                  >
                    {weight != null ? (
                      `${Math.round(weight * 10000) / 100}%`
                    ) : (
                      <em>—</em>
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
