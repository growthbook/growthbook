import { Box, Text, Flex } from "@radix-ui/themes";
import { formatMaxExperimentDuration } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
} from "shared/types/experiment";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaRule,
} from "shared/enterprise";
import Link from "@/ui/Link";

function maxDurationDetail(
  experiment: ExperimentInterfaceStringDates,
): string | null {
  const d = experiment.maxExperimentDuration;
  if (!d) return null;
  return formatMaxExperimentDuration(d);
}

function targetSampleSizeDetail(
  experiment: ExperimentInterfaceStringDates,
): string | null {
  const cap = experiment.targetSampleSize;
  if (cap == null || !Number.isFinite(cap) || cap < 1) return null;
  return `${Math.round(cap).toLocaleString()} users`;
}

interface Props {
  experiment: ExperimentInterfaceStringDates;
  status: ExperimentResultStatusData;
  variations: {
    variationId: string;
    decidingRule: DecisionCriteriaRule | null;
  }[];
  variationNames: Record<string, JSX.Element>;
  showDecisionCriteria: boolean;
  setShowDecisionCriteria: (show: boolean) => void;
  showDecisionCriteriaLink?: boolean;
}

const getRecommendationText = (
  status: ExperimentResultStatusData["status"],
  multipleVariations: boolean,
) => {
  switch (status) {
    case "ship-now":
      return `Review reasons to ship${
        multipleVariations ? " and select the preferred variation" : ""
      }.`;
    case "ready-for-review":
    case "max-duration-reached":
    case "target-sample-size-reached":
      return `Reasons to review${
        multipleVariations ? " the eligible variations" : ""
      }.`;
    case "rollback-now":
      return "Review reasons to rollback.";
    default:
      return "";
  }
};

export default function ExperimentDecisionExplanation({
  experiment,
  status,
  variations,
  variationNames,
  showDecisionCriteria,
  setShowDecisionCriteria,
  showDecisionCriteriaLink,
}: Props) {
  // If the experiment is not in a decision state, don't show anything
  if (
    status.status !== "ship-now" &&
    status.status !== "ready-for-review" &&
    status.status !== "rollback-now" &&
    status.status !== "max-duration-reached" &&
    status.status !== "target-sample-size-reached"
  ) {
    return null;
  }

  const getConditionText = (
    condition: DecisionCriteriaInterface["rules"][0]["conditions"][0],
  ) => {
    const { quantity, connection } = (() => {
      switch (condition.match) {
        case "all":
          return { quantity: "All", connection: "metrics are" };
        case "any":
          return { quantity: "At least one", connection: "metric is" };
        case "none":
          return { quantity: "No", connection: "metrics are" };
      }
    })();

    const metricType = (() => {
      switch (condition.metrics) {
        case "goals":
          return "goal";
        case "guardrails":
          return "guardrail";
      }
    })();

    const direction = (() => {
      switch (condition.direction) {
        case "statsigWinner":
          return "beneficial";
        case "statsigLoser":
          return "harmful";
      }
    })();

    return `${quantity} ${metricType} ${connection} statistically significant and ${direction}`;
  };

  // get the variations that have identical deciding rules
  const decidingRules: {
    variationIds: string[];
    decidingRule: DecisionCriteriaRule | null;
  }[] = [];
  variations.forEach((v) => {
    const existingRule = decidingRules.find(
      (r) => r.decidingRule === v.decidingRule,
    );
    if (existingRule) {
      existingRule.variationIds.push(v.variationId);
    } else {
      decidingRules.push({
        variationIds: [v.variationId],
        decidingRule: v.decidingRule,
      });
    }
  });

  const durationPhrase = maxDurationDetail(experiment);
  const samplePhrase = targetSampleSizeDetail(experiment);

  const viaMaxDuration =
    ("recommendationMetViaMaxDuration" in status &&
      !!status.recommendationMetViaMaxDuration) ||
    status.status === "max-duration-reached";
  const viaTargetSample =
    ("recommendationMetViaTargetSampleSize" in status &&
      !!status.recommendationMetViaTargetSampleSize) ||
    status.status === "target-sample-size-reached";
  /**
   * Target power is considered achieved only when the decision is not attributed
   * to calendar or sample caps (`powerReached` is also true when caps force `daysNeeded === 0`).
   */
  const powerReached = "powerReached" in status ? status.powerReached : false;
  const sequentialUsed =
    "sequentialUsed" in status ? status.sequentialUsed : false;
  const achievedTargetPower =
    powerReached && !viaMaxDuration && !viaTargetSample;

  const readinessReasonBullets: string[] = [];
  if (achievedTargetPower) {
    readinessReasonBullets.push(
      "The experiment has reached the targeted statistical power.",
    );
  } else if (viaMaxDuration && viaTargetSample) {
    const durationClause =
      durationPhrase != null
        ? `maximum duration of ${durationPhrase}`
        : "maximum duration";
    const sampleClause =
      samplePhrase != null
        ? `target sample size of ${samplePhrase}`
        : "target sample size";
    readinessReasonBullets.push(
      `The experiment reached its configured ${durationClause} and reached its configured ${sampleClause}.`,
    );
  } else {
    if (viaMaxDuration) {
      readinessReasonBullets.push(
        durationPhrase != null
          ? `The experiment reached its configured maximum duration of ${durationPhrase}.`
          : "The experiment reached its configured maximum duration.",
      );
    }
    if (viaTargetSample) {
      readinessReasonBullets.push(
        samplePhrase != null
          ? `The experiment reached its configured target sample size of ${samplePhrase}.`
          : "The experiment reached its configured target sample size.",
      );
    }
  }

  return (
    <Box mt="4" ml="3">
      <Text size="2">
        {getRecommendationText(status.status, variations.length > 1)}
      </Text>
      {decidingRules.map((r) => (
        <>
          <Flex direction="column" mb="2">
            <Flex direction="row" gap="1" mb="1">
              {decidingRules.length > 1
                ? r.variationIds.map((v, i) => (
                    <>
                      <Box>{variationNames[v]}</Box>
                      {i !== r.variationIds.length - 1 ? (
                        <Text mx="1">,</Text>
                      ) : null}
                    </>
                  ))
                : null}
            </Flex>
          </Flex>
          <Flex direction="column" gap="2">
            {readinessReasonBullets.length > 0 &&
              readinessReasonBullets.map((line, i) => (
                <Flex key={i} gap="2" align="center">
                  <Text size="2" className="text-muted">
                    •
                  </Text>
                  <Text size="2">{line}</Text>
                </Flex>
              ))}
            {!powerReached && sequentialUsed && (
              <Flex gap="2" align="center">
                <Text size="2" className="text-muted">
                  •
                </Text>
                <Text size="2">
                  Sequential testing was used in the analysis, enabling early
                  stopping.
                </Text>
              </Flex>
            )}
            {r.decidingRule?.conditions.map((condition, i) => (
              <Flex key={i} gap="2" align="center">
                <Text size="2" className="text-muted">
                  •
                </Text>
                <Text size="2">{getConditionText(condition)}</Text>
              </Flex>
            ))}
            {!r.decidingRule && (
              <Flex gap="2" align="center">
                <Text size="2" className="text-muted">
                  •
                </Text>
                <Text size="2">
                  No other decision rules were triggered, and{" "}
                  {status.status === "ship-now"
                    ? "ship"
                    : status.status === "rollback-now"
                      ? "rollback"
                      : "review"}{" "}
                  is the default action.
                </Text>
              </Flex>
            )}
          </Flex>
        </>
      ))}
      {showDecisionCriteriaLink ? (
        <Box mt="4" mb="2">
          <Link onClick={() => setShowDecisionCriteria(!showDecisionCriteria)}>
            View Decision Criteria
          </Link>
        </Box>
      ) : null}
    </Box>
  );
}
