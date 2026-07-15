import {
  ApiContextualBanditInterface,
  ContextualBanditRefRule,
} from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { getConfigBackingKey, getFeatureBaseConfigKey } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { useContextualBandits } from "@/hooks/useContextualBandits";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import Text from "@/ui/Text";
import { getVariationColor } from "@/services/features";
import ValueDisplay from "@/components/Features/ValueDisplay";
import ConfigBackedSummary from "@/components/Features/ConfigBackedSummary";

/** Summary card for a `contextual-bandit-ref` feature rule (status, variation values, weights). */
export default function ContextualBanditRefSummary({
  rule,
  feature,
  environment,
}: {
  rule: ContextualBanditRefRule;
  feature: FeatureInterface;
  // Environment this rule is shown for, so a config-backed arm previews its
  // matching env flavor. Absent (all-environments view) = the base value.
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
      <Flex align="center" gap="2" mb="2" wrap="wrap">
        <Text size="medium" weight="medium">
          <Link href={detailHref}>{cb.name}</Link>
        </Text>
        <Badge
          color={cb.status === "running" ? "green" : "gray"}
          label={cb.status}
        />
        {cb.contextualAttributes.length > 0 && (
          <Text size="small" color="text-low">
            Context: {cb.contextualAttributes.join(", ")}
          </Text>
        )}
      </Flex>

      <Table>
        <TableBody>
          {cb.variations.map((v, i) => {
            const ruleVariation = rule.variations.find(
              (rv) => rv.variationId === v.id,
            );
            const weight = variationWeights[i];
            return (
              <TableRow key={v.id}>
                <TableCell>
                  <Box
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: getVariationColor(i, true),
                      marginRight: 6,
                    }}
                  />
                  {v.name || v.key}
                </TableCell>
                <TableCell>
                  {ruleVariation ? (
                    (() => {
                      // Config-backed arms render "SERVE ConfigName" + resolved
                      // payload (per-env flavor when an environment is set),
                      // never the raw `@config:` directive — matching the
                      // experiment-ref arms table. Arms are sparse patches when
                      // the feature is config-backed (mirrors getFeatureDefinition's
                      // `!!defaultConfigKey`).
                      const defaultConfigKey = getFeatureBaseConfigKey(feature);
                      const configKey =
                        getConfigBackingKey(ruleVariation.value) ??
                        defaultConfigKey;
                      return configKey !== null ? (
                        <ConfigBackedSummary
                          value={ruleVariation.value}
                          configKey={configKey}
                          feature={feature}
                          sparse={defaultConfigKey !== null}
                          environment={environment}
                        />
                      ) : (
                        <ValueDisplay value={ruleVariation.value} type={type} />
                      );
                    })()
                  ) : (
                    <em>not set</em>
                  )}
                </TableCell>
                <TableCell>
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
  );
}
