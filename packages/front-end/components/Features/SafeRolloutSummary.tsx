import { Fragment } from "react";
import {
  expandMetricGroups,
  isFactMetricId,
  isMetricGroupId,
} from "shared/experiments";
import { FeatureInterface } from "shared/types/feature";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { SafeRolloutInterface, SafeRolloutRule } from "shared/validators";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/ui/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import ValueDisplay from "./ValueDisplay";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function SafeRolloutSummary({
  safeRollout,
  rule,
  feature,
}: {
  safeRollout: SafeRolloutInterface;
  rule: SafeRolloutRule;
  feature: FeatureInterface;
}) {
  const coverage = 1;
  const numOfVariations = 2; // Control & Rollout
  const singleVariationCoverage = coverage / numOfVariations;

  const { getFactMetricById, getMetricById, metricGroups } = useDefinitions();
  const getMetricNameAndKey = (metricId: string, groupId?: string) => {
    const key = groupId ? `${groupId}-${metricId}` : metricId;
    let name: string | undefined;

    if (isFactMetricId(metricId)) {
      name = getFactMetricById(metricId)?.name;
    } else {
      name = getMetricById(metricId)?.name;
    }

    return { key, name };
  };

  const { guardrailMetricIds } = safeRollout;
  const metricNames = guardrailMetricIds.flatMap((id) => {
    if (isMetricGroupId(id)) {
      return expandMetricGroups([id], metricGroups).map((metricId) =>
        getMetricNameAndKey(metricId, id),
      );
    }

    return getMetricNameAndKey(id);
  });

  const { controlValue, variationValue, hashAttribute } = rule;
  const type = feature.valueType;
  const rolledBackOrReleased =
    rule.status === "rolled-back" || rule.status === "released";

  if (rolledBackOrReleased) {
    return (
      <Box>
        <Flex gap="3">
          <Box>
            <strong className="font-weight-semibold">SERVE</strong>
          </Box>
          <Box flexGrow="1">
            <ValueDisplay
              value={
                rule.status === "rolled-back" ? controlValue : variationValue
              }
              type={type}
              showFullscreenButton={true}
            />
          </Box>
        </Flex>
      </Box>
    );
  }

  return (
    <Flex direction="column" gap="3">
      <Flex direction="row" gap="2">
        <Text weight="medium">SAMPLE</Text> by{" "}
        <Badge
          color="gray"
          label={
            <Text style={{ color: "var(--slate-12)" }}>{hashAttribute}</Text>
          }
        />
      </Flex>
      <Flex direction="row" gap="2">
        <Text weight="medium">MONITOR</Text>
        <Badge
          color="gray"
          variant="soft"
          label={
            <Tooltip
              content={metricNames.map(({ key, name }) => (
                <Fragment key={key}>
                  {name}
                  <br />
                </Fragment>
              ))}
            >
              <Text style={{ color: "var(--slate-12)" }}>
                {metricNames.length}
              </Text>
            </Tooltip>
          }
        />
        metric{metricNames.length > 1 ? "s" : ""}
      </Flex>
      <ValidateValue value={controlValue} feature={feature} />
      <ValidateValue value={variationValue} feature={feature} />
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
            <ValueRow
              label="Control"
              value={controlValue}
              valueType={type}
              coverage={singleVariationCoverage}
            />
            <ValueRow
              label="Rollout Value"
              value={variationValue}
              valueType={type}
              coverage={singleVariationCoverage}
            />
          </TableBody>
        </Table>
      </Box>
    </Flex>
  );
}

function ValueRow({
  label,
  value,
  valueType,
  coverage,
}: {
  label: string;
  value: string;
  valueType: "string" | "number" | "boolean" | "json";
  coverage: number;
}) {
  return (
    <TableRow style={{ color: "var(--color-text-high)" }}>
      <TableCell style={{ whiteSpace: "nowrap" }}>
        <Text weight="medium">{label}</Text>
      </TableCell>
      <TableCell width="100%">
        <ValueDisplay
          value={value}
          type={valueType}
          showFullscreenButton={true}
        />
      </TableCell>
      <TableCell style={{ color: "var(--color-text-mid)", width: "65%" }}>
        {percentFormatter.format(coverage)}
      </TableCell>
    </TableRow>
  );
}
