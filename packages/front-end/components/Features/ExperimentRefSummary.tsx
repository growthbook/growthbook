import { ExperimentRefRule, FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { includeExperimentInPayload } from "shared/util";
import { FaExclamationTriangle } from "react-icons/fa";
import { Box, Flex } from "@radix-ui/themes";
import { getVariationColor } from "@/services/features";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
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

  const { namespaces } = useOrgSettings();

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
        <Flex align="start" mb="3" gap="3">
          <Box>
            <strong>IF</strong>
          </Box>
          <Box>
            <ConditionDisplay
              condition={phase.condition}
              savedGroups={phase.savedGroups}
              prerequisites={phase.prerequisites}
            />
          </Box>
        </Flex>
      )}

      <Flex gap="3" mb="3">
        <Box>
          <strong>SPLIT</strong>
        </Box>
        <Box>
          {" "}
          by{" "}
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {experiment.hashAttribute || "id"}
          </span>
          {hasNamespace && (
            <>
              {" "}
              <span>in the namespace </span>
              <Link href={`/namespaces`}>
                <span className="mr-1 border px-2 py-1 bg-light rounded">
                  {namespaces?.find((n) => n.name === phase.namespace!.name)
                    ?.label || (
                    <span
                      className="italic text-danger"
                      title="this namespace is not found"
                    >
                      <FaExclamationTriangle /> {phase.namespace!.name}
                    </span>
                  )}
                </span>
              </Link>
            </>
          )}
        </Box>
      </Flex>
      <Flex gap="3" mb="3">
        <Box>
          <strong>INCLUDE</strong>
        </Box>
        <Box>
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {percentFormatter.format(effectiveCoverage)}
          </span>{" "}
          of users in the {isBandit ? "Bandit" : "Experiment"}
          {hasNamespace && (
            <>
              <span> (</span>
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(namespaceRange)}
              </span>{" "}
              of the namespace and{" "}
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(phase?.coverage || 1)}
              </span>
              <span> exposure)</span>
            </>
          )}
        </Box>
      </Flex>
      {releasedValue ? (
        <ForceSummary feature={feature} value={releasedValue.value} />
      ) : (
        <>
          <strong>SERVE</strong>
          <table className="table mt-1 mb-3 bg-light gbtable">
            <tbody>
              {experiment.variations.map((variation, j) => {
                const value =
                  variations.find((v) => v.variationId === variation.id)
                    ?.value ?? "null";

                const weight = phase.variationWeights?.[j] || 0;

                return (
                  <tr key={j}>
                    <td
                      className="text-muted position-relative"
                      style={{ fontSize: "0.9em", width: 25 }}
                    >
                      <div
                        style={{
                          width: "6px",
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: 0,
                          backgroundColor: getVariationColor(j, true),
                        }}
                      />
                      {j}.
                    </td>
                    <td>
                      <ValueDisplay
                        value={value}
                        type={type}
                        showFullscreenButton={true}
                      />
                      <ValidateValue value={value} feature={feature} />
                    </td>
                    <td>{variation.name}</td>
                    {!isBandit && (
                      <td>
                        <div className="d-flex">
                          <div
                            style={{
                              width: "4em",
                              maxWidth: "4em",
                              margin: "0 0 0 auto",
                            }}
                          >
                            {percentFormatter.format(weight)}
                          </div>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!isBandit && (
                <tr>
                  <td colSpan={4}>
                    <ExperimentSplitVisual
                      values={experiment.variations.map((variation, j) => {
                        return {
                          name: variation.name,
                          value:
                            variations.find(
                              (v) => v.variationId === variation.id,
                            )?.value ?? "null",
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
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Flex align="center" gap="3" mb="3">
            <Box>
              <strong>TRACK</strong>
            </Box>
            <Box>
              {" "}
              the result using the key{" "}
              <span className="mr-1 border px-2 py-1 bg-light rounded">
                {experiment.trackingKey}
              </span>{" "}
            </Box>
          </Flex>
        </>
      )}
    </Box>
  );
}
