import { ExperimentRule, FeatureInterface } from "shared/types/feature";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, Text } from "@radix-ui/themes";
import { getVariationColor } from "@/services/features";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import Badge from "@/ui/Badge";
import LinkButton from "@/ui/LinkButton";
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import ValueDisplay from "./ValueDisplay";
import ExperimentSplitVisual from "./ExperimentSplitVisual";

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
  // Calculate total namespace allocation - support both old (single range) and new (multiple ranges) formats
  const namespaceRange = hasNamespace
    ? (() => {
        if (
          "ranges" in namespace &&
          namespace.ranges &&
          namespace.ranges.length > 0
        ) {
          return namespace.ranges.reduce(
            (sum, [start, end]) => sum + (end - start),
            0,
          );
        } else if ("range" in namespace && namespace.range) {
          return namespace.range[1] - namespace.range[0];
        }
        return 1;
      })()
    : 1;
  const effectiveCoverage = namespaceRange * (coverage ?? 1);

  return (
    <Box>
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">SPLIT</Text>
        by
        <Badge
          color="gray"
          label={
            <Text style={{ color: "var(--slate-12)" }}>
              {hashAttribute || ""}
            </Text>
          }
        />
        {hasNamespace && (
          <>
            in the namespace
            <LinkButton href={`/namespaces`} size="xs" variant="soft">
              {allNamespaces?.find((n) => n.name === namespace.name)?.label ||
                namespace.name}
            </LinkButton>
          </>
        )}
      </Flex>
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">INCLUDE</Text>
        <Badge
          color="gray"
          label={
            <Text style={{ color: "var(--slate-12)" }}>
              {percentFormatter.format(effectiveCoverage)}
            </Text>
          }
        />
        of units in the experiment
        {hasNamespace && (
          <>
            (
            <Badge
              color="gray"
              label={
                <Text style={{ color: "var(--slate-12)" }}>
                  {percentFormatter.format(namespaceRange)}
                </Text>
              }
            />
            of the namespace and
            <Badge
              color="gray"
              label={
                <Text style={{ color: "var(--slate-12)" }}>
                  {percentFormatter.format(coverage ?? 1)}
                </Text>
              }
            />
            exposure)
          </>
        )}
      </Flex>
      <Text weight="medium">SERVE</Text>
      <Box
        px="3"
        style={{
          border: "1px solid var(--gray-a5)",
          borderRadius: "var(--radius-2)",
        }}
      >
        <Table>
          <TableBody>
            {values.map((r, j) => (
              <TableRow key={j} style={{ color: "var(--color-text-high)" }}>
                <TableCell style={{ whiteSpace: "nowrap" }}>
                  <Flex align="center" gap="2">
                    <span
                      style={{
                        color: getVariationColor(j, true),
                        borderColor: getVariationColor(j, true),
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
                      {j}
                    </span>
                    <Text weight="medium">{r?.name}</Text>
                  </Flex>
                </TableCell>
                <TableCell width="100%">
                  <ValueDisplay
                    value={r.value}
                    type={type}
                    showFullscreenButton={true}
                  />
                  <ValidateValue value={r.value} feature={feature} />
                </TableCell>
                <TableCell
                  style={{ color: "var(--color-text-mid)", textAlign: "right" }}
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
          label="Traffic split"
          unallocated="Not included (skips this rule)"
          type={type}
          showValues={false}
          stackLeft={true}
          showPercentages={true}
        />
      </Box>
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">TRACK</Text>
        the result using the key
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
            <Link
              href={`/experiment/${experiment.id}#results`}
              className="btn btn-outline-primary"
            >
              View results
            </Link>
          ) : null}
        </Box>
      </Flex>
    </Box>
  );
}
