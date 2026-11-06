import { ExperimentRule, FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, Text } from "@radix-ui/themes";
import { calculateNamespaceCoverage } from "shared/util";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import Badge from "@/ui/Badge";
import LinkButton from "@/ui/LinkButton";
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import { coveragePercentFormatter } from "@/services/utils";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";
import { AttributeBadge } from "./AttributeBadge";
import ValueDisplay, { LISTED_VALUE_STYLE } from "./ValueDisplay";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import RolloutRow from "./RolloutRow";
import RuleField from "./RuleField";
import variationsTableStyles from "./RuleVariationsTable.module.scss";

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
  const { namespace, coverage, values, hashAttribute, trackingKey } = rule;
  const type = feature.valueType;
  const { namespaces: allNamespaces } = useOrgSettings();

  const hasNamespace = namespace && namespace.enabled;
  // Calculate total namespace allocation
  const namespaceRange =
    hasNamespace && namespace ? calculateNamespaceCoverage(namespace) : 1;
  const effectiveCoverage = namespaceRange * (coverage ?? 1);

  return (
    <Box>
      <RuleField label="Split by">
        <Flex align="center" gap="2" wrap="wrap">
          <AttributeBadge attributeId={hashAttribute || "id"} />
          {hasNamespace && (
            <>
              in the namespace
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
            (
            <Badge
              color="gray"
              label={
                <Text style={{ color: "var(--slate-12)" }}>
                  {percentFormatter.format(namespaceRange)}
                </Text>
              }
            />{" "}
            of the namespace and{" "}
            <Badge
              color="gray"
              label={
                <Text style={{ color: "var(--slate-12)" }}>
                  {coveragePercentFormatter.format(coverage ?? 1)}
                </Text>
              }
            />{" "}
            exposure)
          </>
        )}
      </RolloutRow>
      <RuleField label="Serve" align="start">
        <Box>
          <Table variant="surface" className={variationsTableStyles.table}>
            <TableBody>
              {values.map((r, j) => (
                <TableRow key={j} style={{ color: "var(--color-text-high)" }}>
                  <TableCell style={{ whiteSpace: "nowrap" }}>
                    <Tooltip content={r?.name}>
                      <Box className={variationsTableStyles.marker}>
                        <VariationNumber number={j} />
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell width="100%">
                    <ValueDisplay
                      value={r.value}
                      type={type}
                      fullStyle={LISTED_VALUE_STYLE}
                      showFullscreenButton={true}
                      actionsOverlay={{ inline: true }}
                    />
                    <ValidateValue value={r.value} feature={feature} />
                  </TableCell>
                  <TableCell
                    style={{
                      color: "var(--color-text-mid)",
                      textAlign: "right",
                    }}
                  >
                    {percentFormatter.format(r.weight)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Box mt="3">
          <ExperimentSplitVisual
            values={values}
            coverage={effectiveCoverage}
            condensed
            label="Traffic split"
            unallocated="Not included (skips this rule)"
            type={type}
            showValues={false}
            stackLeft={true}
            showPercentages={true}
          />
        </Box>
      </RuleField>
      <RuleField label="Tracking key" mb="0">
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
                View results
              </LinkButton>
            ) : null}
          </Box>
        </Flex>
      </RuleField>
    </Box>
  );
}
