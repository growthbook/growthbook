import { ExperimentRule, FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, Text } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import { calculateNamespaceCoverage } from "shared/util";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import Badge from "@/ui/Badge";
import LinkButton from "@/ui/LinkButton";
import { coveragePercentFormatter } from "@/services/utils";
import { AttributeBadge } from "./AttributeBadge";
import ValueDisplay, { LISTED_VALUE_STYLE } from "./ValueDisplay";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import RolloutRow from "./RolloutRow";
import RuleField from "./RuleField";
import RuleVariationsTable from "./RuleVariationsTable";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ExperimentSummary({
  rule,
  experiment,
  feature,
}: {
  feature: FeatureInterface;
  experiment?: ExperimentInterfaceStringDates;
  rule: ExperimentRule;
}) {
  const { t } = useLingui();
  const { namespace, coverage, values, hashAttribute, trackingKey } = rule;
  const type = feature.valueType;
  const { namespaces: allNamespaces } = useOrgSettings();

  const hasNamespace = namespace && namespace.enabled;
  // Calculate total namespace allocation
  const namespaceRange =
    hasNamespace && namespace ? calculateNamespaceCoverage(namespace) : 1;
  const effectiveCoverage = namespaceRange * (coverage ?? 1);
  const namespacePercent = percentFormatter.format(namespaceRange);
  const exposurePercent = coveragePercentFormatter.format(coverage ?? 1);

  return (
    <Box>
      <RuleField label={t`Split by`}>
        <Flex align="center" gap="2" wrap="wrap">
          <AttributeBadge attributeId={hashAttribute || "id"} />
          {hasNamespace && (
            <>
              <Trans>in the namespace</Trans>
              <LinkButton href={`/namespaces`} size="sm" variant="soft">
                {allNamespaces?.find((n) => n.name === namespace.name)?.label ||
                  namespace.name}
              </LinkButton>
            </>
          )}
        </Flex>
      </RuleField>
      <RolloutRow coverage={effectiveCoverage}>
        {hasNamespace && (
          <>
            {" "}
            <Trans>
              (
              <Badge
                color="gray"
                label={
                  <Text style={{ color: "var(--slate-12)" }}>
                    {namespacePercent}
                  </Text>
                }
              />{" "}
              of the namespace and{" "}
              <Badge
                color="gray"
                label={
                  <Text style={{ color: "var(--slate-12)" }}>
                    {exposurePercent}
                  </Text>
                }
              />{" "}
              exposure)
            </Trans>
          </>
        )}
      </RolloutRow>
      <RuleField label={t`Serve`} align="start">
        <Box>
          <RuleVariationsTable
            rows={values.map((r, j) => ({
              key: String(j),
              name: r.name ?? "",
              weight: r.weight,
              value: (
                <>
                  <ValueDisplay
                    value={r.value}
                    type={type}
                    fullStyle={LISTED_VALUE_STYLE}
                    showFullscreenButton={true}
                    actionsOverlay={{ inline: true }}
                  />
                  <ValidateValue value={r.value} feature={feature} />
                </>
              ),
            }))}
          />
        </Box>
        <Box mt="3">
          <ExperimentSplitVisual
            values={values}
            coverage={effectiveCoverage}
            condensed
            label={t`Traffic split`}
            unallocated={t`Not included (skips this rule)`}
            type={type}
            showValues={false}
            stackLeft={true}
            showPercentages={true}
          />
        </Box>
      </RuleField>
      <RuleField label={t`Tracking key`} mb="0">
        <Flex align="center" gap="2" wrap="wrap">
          <Badge
            color="gray"
            label={
              <Text style={{ color: "var(--slate-12)" }}>
                {trackingKey || feature.id}
              </Text>
            }
          />
          <Box>
            {experiment ? (
              <LinkButton
                href={`/experiment/${experiment.id}#results`}
                variant="outline"
              >
                <Trans>View results</Trans>
              </LinkButton>
            ) : null}
          </Box>
        </Flex>
      </RuleField>
    </Box>
  );
}
