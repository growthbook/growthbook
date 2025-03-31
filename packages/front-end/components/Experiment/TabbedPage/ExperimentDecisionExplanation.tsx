import { Box, Text, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { DecisionFrameworkExperimentRecommendationStatus } from "back-end/types/experiment";
import { DecisionCriteriaInterface } from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";
import { DEFAULT_DECISION_CRITERIA } from "shared/enterprise";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  status: DecisionFrameworkExperimentRecommendationStatus;
}

export default function ExperimentDecisionExplanation({
  experiment,
  status,
}: Props) {
  const decisionCriteria = experiment.decisionCriteria ?? DEFAULT_DECISION_CRITERIA;

  // If the experiment is not in a decision state, don't show anything
  if (
    status.status !== "ship-now" &&
    status.status !== "ready-for-review" &&
    status.status !== "rollback-now"
  ) {
    return null;
  }

  // Find the matching rule that triggered this status
  const matchingRule = decisionCriteria.rules.find((rule) => {
    // For now, we'll just match based on the action
    // TODO match on actual rule, or pass it up
    return (
      (status.status === "ship-now" && rule.action === "ship") ||
      (status.status === "rollback-now" && rule.action === "rollback") ||
      (status.status === "ready-for-review" && rule.action === "review")
    );
  });

  // fix to get deciding rule
  const getConditionText = (condition: DecisionCriteriaInterface["rules"][0]["conditions"][0]) => {
    const metricType = condition.metrics === "goals" ? "goal" : "guardrail";
    // TODO switch statements
    const direction = condition.direction === "statsigWinner" ? "beneficial" : "harmful";
    return `${metricType} metrics are statistically significant and ${direction}`;
  };

  return (
    <Box className="mt-2">
      <Text size="2" weight="medium" className="mb-2">
        This recommendation is based on:
      </Text>
      <Flex direction="column" gap="2">
        {matchingRule?.conditions.map((condition, i) => (
          <Flex key={i} gap="2" align="center">
            <Text size="2" className="text-muted">
              •
            </Text>
            <Text size="2">
              {condition.match === "all" && "All "}
              {condition.match === "any" && "Any "}
              {condition.match === "none" && "No "}
              {getConditionText(condition)}
            </Text>
          </Flex>
        ))}
        {status.powerReached && (
          <Flex gap="2" align="center">
            <Text size="2" className="text-muted">
              •
            </Text>
            <Text size="2">Required statistical power has been reached</Text>
          </Flex>
        )}
        {!status.powerReached && status.sequentialUsed && (
          <Flex gap="2" align="center">
            <Text size="2" className="text-muted">
              •
            </Text>
            <Text size="2">Sequential testing was used in the analysis, enabling early stopping</Text>
          </Flex>
        )}
      </Flex>
      {/* TODO manage decision criteria */}
    </Box>
  );
} 