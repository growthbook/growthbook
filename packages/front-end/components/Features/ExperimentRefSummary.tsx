import { ExperimentRefRule, FeatureInterface } from "shared/types/feature";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React from "react";
import { includeExperimentInPayload } from "shared/util";
import { FaExclamationTriangle } from "react-icons/fa";
import { Box, Flex, Text } from "@radix-ui/themes";
import { getVariationColor } from "@/services/features";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import ValueDisplay from "./ValueDisplay";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function isExperimentRefRuleSkipped(
  experiment: ExperimentInterfaceStringDates,
  isDraft: boolean,
) {
  if (experiment.status === "draft" && !experiment.archived) {
    // Draft experiments are published alongside feature drafts,
    // so don't need to mark this as skipped if we're viewing a feature draft
    return !isDraft;
  }
  return !includeExperimentInPayload(experiment);
}

export default function ExperimentRefSummary({
  rule,
  experiment,
  feature,
  isDraft,
}: {
  feature: FeatureInterface;
  experiment?: ExperimentInterfaceStringDates;
  rule: ExperimentRefRule;
  isDraft: boolean;
}) {
  const { variations } = rule;
  const type = feature.valueType;

  const { namespaces, useStickyBucketing } = useOrgSettings();

  const isBandit = experiment?.type === "multi-armed-bandit";

  if (!experiment) {
    return <Callout status="error">The experiment could not be found.</Callout>;
  }

  if (experiment.archived) {
    return (
      <Callout status="info">
        This {isBandit ? "Bandit" : "Experiment"} is archived and will be
        skipped.{" "}
        <Link href={`/experiment/${experiment.id}`}>
          View {isBandit ? "Bandit" : "Experiment"}
        </Link>
      </Callout>
    );
  }

  const phase = experiment.phases[experiment.phases.length - 1];
  if (!phase) {
    return (
      <Callout status="info">
        This {isBandit ? "Bandit" : "Experiment"} is not running and rule will
        be skipped.{" "}
        <Link href={`/experiment/${experiment.id}`}>
          View {isBandit ? "Bandit" : "Experiment"}
        </Link>
      </Callout>
    );
  }

  const releasedValue =
    experiment.status === "stopped" && !experiment.excludeFromPayload
      ? rule.variations.find(
          (v) => v.variationId === experiment.releasedVariationId,
        )
      : null;

  if (experiment.status === "stopped" && !releasedValue) {
    return (
      <Callout status="info">
        This {isBandit ? "Bandit" : "Experiment"} is stopped and does not have a{" "}
        <strong>Temporary Rollout</strong> enabled. This rule will be skipped.{" "}
        <Link href={`/experiment/${experiment.id}#results`}>View Results</Link>
      </Callout>
    );
  }

  const hasNamespace = phase.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace!.range[1] - phase.namespace!.range[0]
    : 1;
  const effectiveCoverage = namespaceRange * (phase.coverage ?? 1);

  const hasCondition =
    (phase.condition && phase.condition !== "{}") ||
    !!phase.savedGroups?.length ||
    !!phase.prerequisites?.length;

  return (
    <Box>
      {experiment.status === "draft" && !isDraft && (
        <Callout status="warning" mb="3">
          This {isBandit ? "Bandit" : "Experiment"} is in a{" "}
          <strong>draft</strong> state and has not been started yet. This rule
          will be skipped.
        </Callout>
      )}
      {experiment.status === "stopped" && (
        <Callout status="info" mb="3">
          This {isBandit ? "Bandit" : "Experiment"} is stopped and a{" "}
          <strong>Temporary Rollout</strong> is enabled. All users in the{" "}
          {isBandit ? "Bandit" : "Experiment"} will receive the winning
          variation. If no longer needed, you can stop it from the{" "}
          {isBandit ? "Bandit" : "Experiment"} page.
        </Callout>
      )}
      {hasCondition && (
        <Flex direction="row" gap="2" mb="3">
          <Text weight="medium">IF</Text>
          <Box>
            <ConditionDisplay
              condition={phase.condition}
              savedGroups={phase.savedGroups}
              prerequisites={phase.prerequisites}
            />
          </Box>
        </Flex>
      )}

      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">SPLIT</Text>
        by
        <Badge
          color="gray"
          label={
            <Text style={{ color: "var(--slate-12)" }}>
              {experiment.hashAttribute || "id"}
            </Text>
          }
        />
        {hasNamespace && (
          <>
            in the namespace
            <Link href={`/namespaces`}>
              <Badge
                color="gray"
                label={
                  <Text style={{ color: "var(--slate-12)" }}>
                    {namespaces?.find((n) => n.name === phase.namespace!.name)
                      ?.label || (
                      <span
                        className="italic text-danger"
                        title="this namespace is not found"
                      >
                        <FaExclamationTriangle /> {phase.namespace!.name}
                      </span>
                    )}
                  </Text>
                }
              />
            </Link>
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
        of units in the {isBandit ? "Bandit" : "Experiment"}
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
                  {percentFormatter.format(phase?.coverage || 1)}
                </Text>
              }
            />
            exposure)
          </>
        )}
      </Flex>
      {releasedValue ? (
        <ForceSummary feature={feature} value={releasedValue.value} />
      ) : (
        <>
          <Text weight="medium">SERVE</Text>
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
                {experiment.variations.map((variation, j) => {
                  const value =
                    variations.find((v) => v.variationId === variation.id)
                      ?.value ?? "null";

                  const weight = phase.variationWeights?.[j] || 0;

                  return (
                    <TableRow
                      key={j}
                      style={{ color: "var(--color-text-high)" }}
                    >
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
                          <Text weight="medium">{variation.name}</Text>
                        </Flex>
                      </TableCell>
                      <TableCell width="100%">
                        <ValueDisplay
                          value={value}
                          type={type}
                          showFullscreenButton={true}
                        />
                        <ValidateValue value={value} feature={feature} />
                      </TableCell>
                      {!isBandit && (
                        <TableCell
                          style={{
                            color: "var(--color-text-mid)",
                            textAlign: "right",
                          }}
                        >
                          {percentFormatter.format(weight)}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          {useStickyBucketing ? (
            <Box mt="3">
              <Text weight="medium">WITH</Text> Sticky Bucketing{" "}
              {experiment.disableStickyBucketing ? "disabled" : "enabled"}
            </Box>
          ) : null}
          <Box mt="3">
            {!isBandit && (
              <ExperimentSplitVisual
                values={experiment.variations.map((variation, j) => {
                  return {
                    name: variation.name,
                    value:
                      variations.find((v) => v.variationId === variation.id)
                        ?.value ?? "null",
                    weight: phase.variationWeights?.[j] || 0,
                  };
                })}
                coverage={effectiveCoverage}
                label="Traffic split"
                unallocated="Not included (skips this rule)"
                type={type}
                showValues={false}
                stackLeft={true}
                showPercentages={true}
              />
            )}
          </Box>

          <Flex direction="row" gap="2" mb="3">
            <Text weight="medium">TRACK</Text>
            the result using the key
            <Badge
              color="gray"
              label={
                <Text style={{ color: "var(--slate-12)" }}>
                  {experiment.trackingKey}
                </Text>
              }
            />
          </Flex>
        </>
      )}
    </Box>
  );
}
