import { Fragment } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { SafeRolloutRule } from "back-end/src/validators/features";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/components/Radix/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import Table, { TableBody, TableRow, TableCell } from "../Radix/Table";
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

  const { getMetricById } = useDefinitions();
  const { guardrailMetricIds } = safeRollout;
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
          <Box>
            <ValueDisplay
              value={
                rule.status === "rolled-back" ? controlValue : variationValue
              }
              type={type}
            />
          </Box>
        </Flex>
      </Box>
    );
  }

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Flex direction="row" gap="2">
          <Text weight="medium">SPLIT</Text>users by
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
                content={guardrailMetricIds.map((id) => (
                  <Fragment key={id}>
                    {getMetricById(id)?.name}
                    <br />
                  </Fragment>
                ))}
              >
                <Text style={{ color: "var(--slate-12)" }}>
                  {guardrailMetricIds.length}
                </Text>
              </Tooltip>
            }
          />
          metric{guardrailMetricIds.length > 1 ? "s" : ""}
        </Flex>
        <ValidateValue value={controlValue} feature={feature} />
        <ValidateValue value={variationValue} feature={feature} />
      </Flex>
      <Box
        px="3"
        py="1"
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
      <TableCell>
        <Text weight="medium">{label}</Text>
      </TableCell>
      <TableCell>
        <ValueDisplay value={value} type={valueType} />
      </TableCell>
      <TableCell style={{ color: "var(--color-text-mid)", width: "65%" }}>
        {percentFormatter.format(coverage)}
      </TableCell>
    </TableRow>
  );
}
