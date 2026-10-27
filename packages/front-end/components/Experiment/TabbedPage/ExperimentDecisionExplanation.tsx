import { Box, Flex } from "@radix-ui/themes";
import { DecisionFrameworkExperimentRecommendationStatus } from "shared/types/experiment";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaRule,
} from "shared/enterprise";
import { Fragment, ReactNode } from "react";
import { PiCheckCircleBold, PiXCircleBold } from "react-icons/pi";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

interface Props {
  status: DecisionFrameworkExperimentRecommendationStatus;
  variations: {
    variationId: string;
    decidingRule: DecisionCriteriaRule | null;
  }[];
  variationNames: Record<string, JSX.Element>;
  showDecisionCriteria: boolean;
  setShowDecisionCriteria: (show: boolean) => void;
  showDecisionCriteriaLink?: boolean;
  // The decision's colour, for each reason's icon.
  reasonColor: ReasonColor;
}

const getRecommendationText = (
  status: "ship-now" | "ready-for-review" | "rollback-now",
  multipleVariations: boolean,
) => {
  switch (status) {
    case "ship-now":
      return multipleVariations
        ? "Reasons to ship (select the preferred variation):"
        : "Reasons to ship:";
    case "ready-for-review":
      return multipleVariations
        ? "Reasons to review the eligible variations:"
        : "Reasons to review:";
    case "rollback-now":
      return "Reasons to roll back:";
  }
};

export default function ExperimentDecisionExplanation({
  status,
  variations,
  variationNames,
  showDecisionCriteria,
  setShowDecisionCriteria,
  showDecisionCriteriaLink,
  reasonColor,
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
    <Box>
      <Text as="div" mb="2">
        {getRecommendationText(status.status, variations.length > 1)}
      </Text>
      {decidingRules.map((r) => (
        <Fragment key={JSON.stringify(r.variationIds)}>
          {decidingRules.length > 1 ? (
            <Flex align="center" gap="1" mt="2" mb="1">
              {r.variationIds.map((v, i) => (
                <Fragment key={v}>
                  <Box>{variationNames[v]}</Box>
                  {i !== r.variationIds.length - 1 ? <Text>,</Text> : null}
                </Fragment>
              ))}
            </Flex>
          ) : null}
          <Flex direction="column" gap="1">
            {status.powerReached && (
              <Reason color={reasonColor}>
                The experiment has reached the targeted statistical power.
              </Reason>
            )}
            {!status.powerReached && status.scheduledEndPassed && (
              <Reason color={reasonColor}>
                The scheduled end date has passed and a recommendation can be
                made.
              </Reason>
            )}
            {!status.powerReached &&
              !status.scheduledEndPassed &&
              status.sequentialUsed && (
                <Reason color={reasonColor}>
                  Sequential testing was used in the analysis, enabling early
                  stopping.
                </Reason>
              )}
            {r.decidingRule?.conditions.map((condition, i) => (
              <Reason key={i} color={reasonColor}>
                {getConditionText(condition)}
              </Reason>
            ))}
            {!r.decidingRule && (
              <Reason color={reasonColor}>
                No other decision rules were triggered, and{" "}
                {status.status === "ship-now"
                  ? "ship"
                  : status.status === "ready-for-review"
                    ? "review"
                    : "rollback"}{" "}
                is the default action.
              </Reason>
            )}
          </Flex>
        </Fragment>
      ))}
      {showDecisionCriteriaLink ? (
        <Box mt="3" mb="1">
          <Link onClick={() => setShowDecisionCriteria(!showDecisionCriteria)}>
            View decision criteria
          </Link>
        </Box>
      ) : null}
    </Box>
  );
}

type ReasonColor = "green" | "amber" | "red";

// A roll back's reasons count against the variation; the others for it.
export function Reason({
  color,
  icon = color === "red" ? <PiXCircleBold /> : <PiCheckCircleBold />,
  children,
}: {
  color: ReasonColor;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Flex gap="2" align="start">
      {/* Level with the reason's first line. */}
      <Flex
        flexShrink="0"
        align="center"
        style={{ height: "var(--line-height-2)", color: `var(--${color}-11)` }}
      >
        {icon}
      </Flex>
      <Text>{children}</Text>
    </Flex>
  );
}
