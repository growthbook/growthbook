import { Box, Text, Flex } from "@radix-ui/themes";
import { DecisionFrameworkExperimentRecommendationStatus } from "back-end/types/experiment";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaRule,
} from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";
import Link from "@/components/Radix/Link";

interface Props {
  status: DecisionFrameworkExperimentRecommendationStatus;
  variations: {
    variationId: string;
    decidingRule: DecisionCriteriaRule | null;
  }[];
  variationNames: Record<string, JSX.Element>;
  showDecisionCriteria: boolean;
  setShowDecisionCriteria: (show: boolean) => void;
}

export default function ExperimentDecisionExplanation({
  status,
  variations,
  variationNames,
  showDecisionCriteria,
  setShowDecisionCriteria,
}: Props) {
  // If the experiment is not in a decision state, don't show anything
  if (
    status.status !== "ship-now" &&
    status.status !== "ready-for-review" &&
    status.status !== "rollback-now"
  ) {
    return null;
  }

  // fix to get deciding rule
  const getConditionText = (
    condition: DecisionCriteriaInterface["rules"][0]["conditions"][0]
  ) => {
    const metricType = condition.metrics === "goals" ? "goal" : "guardrail";
    // TODO switch statements
    const direction =
      condition.direction === "statsigWinner" ? "beneficial" : "harmful";
    return `${metricType} metrics are statistically significant and ${direction}`;
  };

  // get the variations that have identical deciding rules
  const decidingRules: {
    variationIds: string[];
    decidingRule: DecisionCriteriaRule | null;
  }[] = [];
  variations.forEach((v) => {
    const existingRule = decidingRules.find(
      (r) => r.decidingRule === v.decidingRule
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

  // TODO: sort deciding rules so null is last
  decidingRules.sort((a, b) => {
    if (a.decidingRule === null) {
      return 1;
    }
    if (b.decidingRule === null) {
      return -1;
    }
    return 0;
  });

  return (
    <Box mt="4">
      {decidingRules.map((r) => (
        <>
          <Flex direction="column" mb="2">
            <Flex direction="row" gap="1" mb="1">
              {r.variationIds.map((v, i) => (
                <>
                  <Box>{variationNames[v]}</Box>
                  {i !== r.variationIds.length - 1 ? <Text>&</Text> : null}
                </>
              ))}
            </Flex>
            <Text size="2">
              The recommendation to{" "}
              {status.status === "ship-now"
                ? "ship"
                : status.status === "ready-for-review"
                ? "review"
                : "rollback"}{" "}
              is based on:
            </Text>
          </Flex>
          <Flex direction="column" gap="2">
            {status.powerReached && (
              <Flex gap="2" align="center">
                <Text size="2" className="text-muted">
                  •
                </Text>
                <Text size="2">
                  The required statistical power for the experiment has been
                  reached
                </Text>
              </Flex>
            )}
            {!status.powerReached && status.sequentialUsed && (
              <Flex gap="2" align="center">
                <Text size="2" className="text-muted">
                  •
                </Text>
                <Text size="2">
                  Sequential testing was used in the analysis, enabling early
                  stopping
                </Text>
              </Flex>
            )}
            {r.decidingRule?.conditions.map((condition, i) => (
              <Flex key={i} gap="2" align="center">
                <Text size="2" className="text-muted">
                  •
                </Text>
                <Text size="2">
                  {condition.match === "all" && "All "}
                  {condition.match === "any" && "At least one "}
                  {condition.match === "none" && "No "}
                  {getConditionText(condition)}
                </Text>
              </Flex>
            ))}
            {!r.decidingRule && (
              <Flex gap="2" align="center">
                <Text size="2" className="text-muted">
                  •
                </Text>
                <Text size="2">
                  No other decision criteria were triggered, and{" "}
                  {status.status === "ship-now"
                    ? "ship"
                    : status.status === "ready-for-review"
                    ? "review"
                    : "rollback"}{" "}
                  is the default action.
                </Text>
              </Flex>
            )}
          </Flex>
        </>
      ))}
      <Box mt="4">
        <Link onClick={() => setShowDecisionCriteria(!showDecisionCriteria)}>
          View Decision Criteria
        </Link>
      </Box>
    </Box>
  );
}
