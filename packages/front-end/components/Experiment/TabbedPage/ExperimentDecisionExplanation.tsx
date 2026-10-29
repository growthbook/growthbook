import isEqual from "lodash/isEqual";
import { Box, Flex } from "@radix-ui/themes";
import { DecisionFrameworkExperimentRecommendationStatus } from "shared/types/experiment";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaRule,
} from "shared/enterprise";
import { Fragment, ReactNode } from "react";
import {
  PiCheckCircleBold,
  PiMinusCircleBold,
  PiWarningBold,
  PiXCircleBold,
} from "react-icons/pi";
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
  // Beside the criteria link.
  action?: ReactNode;
  // The decision criteria's name, for a decision its default made.
  criteriaName?: string;
  // How many goal metrics it has, for the wording.
  goalMetricCount?: number;
  // Each variation's results, by id, under a decision its default made.
  outcomes?: Record<string, ReactNode>;
  // For a ship tied between variations: who's tied, and how it's broken.
  tie?: { text: ReactNode; hint: ReactNode } | null;
  // Doubts about the results behind it, after the reasons.
  cautions?: { text: ReactNode; hint?: ReactNode }[];
  // The decision's colour, for each reason's icon.
  reasonColor: ReasonColor;
}

const REASONS_HEADING = {
  "ship-now": "Reasons to ship:",
  "ready-for-review": "Why there's no clear winner:",
  "rollback-now": "Reasons to roll back:",
} as const;

export default function ExperimentDecisionExplanation({
  status,
  variations,
  variationNames,
  showDecisionCriteria,
  setShowDecisionCriteria,
  showDecisionCriteriaLink,
  action,
  criteriaName,
  goalMetricCount,
  outcomes = {},
  tie,
  cautions = [],
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

    return `${quantity} ${metricType} ${connection} statistically significant and ${direction}.`;
  };

  // get the variations that have identical deciding rules
  const decidingRules: {
    variationIds: string[];
    decidingRule: DecisionCriteriaRule | null;
  }[] = [];
  variations.forEach((v) => {
    const existingRule = decidingRules.find((r) =>
      isEqual(r.decidingRule, v.decidingRule),
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

  // No call reads as neither a pass nor a fail.
  const decisionIcon =
    status.status === "ready-for-review" ? <PiMinusCircleBold /> : undefined;

  return (
    <Box>
      <Text as="div" mb="2">
        {REASONS_HEADING[status.status]}
      </Text>
      {/* Enough data to decide on: good news, whatever the decision. */}
      <Reason
        color="green"
        hint={
          status.powerReached
            ? `Running longer would only detect effects smaller than its ${
                goalMetricCount === 1
                  ? "goal metric's target"
                  : "goal metrics' targets"
              }.`
            : undefined
        }
      >
        {status.powerReached
          ? "Enough data to detect its target effect."
          : status.scheduledEndPassed
            ? "Its scheduled end has passed, so it can be decided now."
            : status.sequentialUsed
              ? "Sequential testing lets it be decided early."
              : "Its results are strong enough to decide early."}
      </Reason>
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
          <Flex direction="column" gap="1" mt="1">
            {r.decidingRule?.conditions.map((condition, i) => (
              <Reason key={i} color={reasonColor} icon={decisionIcon}>
                {getConditionText(condition)}
              </Reason>
            ))}
            {!r.decidingRule && (
              <Reason
                color={reasonColor}
                icon={decisionIcon}
                hint={
                  r.variationIds.some((id) => outcomes[id])
                    ? r.variationIds.map((id) => (
                        <Fragment key={id}>{outcomes[id]}</Fragment>
                      ))
                    : undefined
                }
              >
                No rule in {criteriaName ?? "your decision criteria"} matched,
                so{" "}
                {status.status === "ship-now"
                  ? "it ships by default"
                  : status.status === "ready-for-review"
                    ? "the call is yours"
                    : "it rolls back by default"}
                .
              </Reason>
            )}
          </Flex>
        </Fragment>
      ))}
      {tie ? (
        <Box mt="1">
          <Reason color="gray" icon={<PiMinusCircleBold />} hint={tie.hint}>
            {tie.text}
          </Reason>
        </Box>
      ) : null}
      {cautions.length ? (
        <>
          <Text as="div" mt="3" mb="2">
            Caution:
          </Text>
          <Flex direction="column" gap="1">
            {cautions.map(({ text, hint }, i) => (
              <Reason
                key={i}
                color="amber"
                icon={<PiWarningBold />}
                hint={hint}
              >
                {text}
              </Reason>
            ))}
          </Flex>
        </>
      ) : null}
      {action || showDecisionCriteriaLink ? (
        <Flex mt="3" mb="1" align="center" gap="4">
          {action}
          {showDecisionCriteriaLink ? (
            <Link
              onClick={() => setShowDecisionCriteria(!showDecisionCriteria)}
            >
              View decision criteria
            </Link>
          ) : null}
        </Flex>
      ) : null}
    </Box>
  );
}

type ReasonColor = "green" | "amber" | "gray" | "red";

// A roll back's reasons count against the variation; the others for it.
export function Reason({
  color,
  icon = color === "red" ? <PiXCircleBold /> : <PiCheckCircleBold />,
  hint,
  children,
}: {
  color: ReasonColor;
  icon?: ReactNode;
  // A line under it, set off by a rule.
  hint?: ReactNode;
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
      <Box>
        <Text as="div">{children}</Text>
        {hint ? (
          <Box mt="1" pl="2" style={{ borderLeft: "2px solid var(--gray-a5)" }}>
            <Text as="div">{hint}</Text>
          </Box>
        ) : null}
      </Box>
    </Flex>
  );
}
