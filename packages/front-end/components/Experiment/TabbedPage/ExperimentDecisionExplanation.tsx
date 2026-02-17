import { Box, Text, Flex } from "@radix-ui/themes";
import { DecisionFrameworkExperimentRecommendationStatus } from "shared/types/experiment";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaRule,
} from "shared/enterprise";
import Link from "@/ui/Link";

interface Props {
  status: DecisionFrameworkExperimentRecommendationStatus;
  variations: {
    variationId: string;
    decidingRule: DecisionCriteriaRule | null;
  }[];
  variationNames: Record<string, React.ReactNode>;
  showDecisionCriteria: boolean;
  setShowDecisionCriteria: (show: boolean) => void;
  showDecisionCriteriaLink?: boolean;
}

const getRecommendationText = (
  status: "ship-now" | "ready-for-review" | "rollback-now",
  multipleVariations: boolean,
) => {
  switch (status) {
    case "ship-now":
      return `Review reasons to ship${
        multipleVariations ? " and select the preferred variation" : ""
      }.`;
    case "ready-for-review":
      return `Reasons to review${
        multipleVariations ? " the eligible variations" : ""
      }.`;
    case "rollback-now":
      return "Review reasons to rollback.";
  }
};

export default function ExperimentDecisionExplanation({
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
    status.status !== "rollback-now"
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
            {status.powerReached && (
              <Flex gap="2" align="center">
                <Text size="2" className="text-muted">
                  •
                </Text>
                <Text size="2">
                  The experiment has reached the targeted statistical power.
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
