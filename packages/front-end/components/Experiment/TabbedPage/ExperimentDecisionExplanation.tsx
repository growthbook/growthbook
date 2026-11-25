import isEqual from "lodash/isEqual";
import { Box, Flex } from "@radix-ui/themes";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  "ship-now": msg`Reasons to ship:`,
  "ready-for-review": msg`Why there's no clear winner:`,
  "rollback-now": msg`Reasons to roll back:`,
} as const;

type Condition = DecisionCriteriaInterface["rules"][0]["conditions"][0];

// Each condition as one sentence, by match, metrics and direction.
const CONDITION_TEXT: Record<
  Condition["match"],
  Record<
    Condition["metrics"],
    Record<Condition["direction"], MessageDescriptor>
  >
> = {
  all: {
    goals: {
      statsigWinner: msg`All goal metrics are statistically significant and beneficial.`,
      statsigLoser: msg`All goal metrics are statistically significant and harmful.`,
    },
    guardrails: {
      statsigWinner: msg`All guardrail metrics are statistically significant and beneficial.`,
      statsigLoser: msg`All guardrail metrics are statistically significant and harmful.`,
    },
  },
  any: {
    goals: {
      statsigWinner: msg`At least one goal metric is statistically significant and beneficial.`,
      statsigLoser: msg`At least one goal metric is statistically significant and harmful.`,
    },
    guardrails: {
      statsigWinner: msg`At least one guardrail metric is statistically significant and beneficial.`,
      statsigLoser: msg`At least one guardrail metric is statistically significant and harmful.`,
    },
  },
  none: {
    goals: {
      statsigWinner: msg`No goal metrics are statistically significant and beneficial.`,
      statsigLoser: msg`No goal metrics are statistically significant and harmful.`,
    },
    guardrails: {
      statsigWinner: msg`No guardrail metrics are statistically significant and beneficial.`,
      statsigLoser: msg`No guardrail metrics are statistically significant and harmful.`,
    },
  },
};

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
  const { t, i18n } = useLingui();
  // If the experiment is not in a decision state, don't show anything
  if (
    status.status !== "ship-now" &&
    status.status !== "ready-for-review" &&
    status.status !== "rollback-now"
  ) {
    return null;
  }

  const getConditionText = (condition: Condition) =>
    i18n._(
      CONDITION_TEXT[condition.match][condition.metrics][condition.direction],
    );

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
        {i18n._(REASONS_HEADING[status.status])}
      </Text>
      {/* Enough data to decide on: good news, whatever the decision. */}
      <Reason
        color="green"
        hint={
          status.powerReached
            ? goalMetricCount === 1
              ? t`Running longer would only detect effects smaller than its goal metric's target.`
              : t`Running longer would only detect effects smaller than its goal metrics' targets.`
            : undefined
        }
      >
        {status.powerReached ? (
          <Trans>Enough data to detect its target effect.</Trans>
        ) : status.scheduledEndPassed ? (
          <Trans>Its scheduled end has passed, so it can be decided now.</Trans>
        ) : status.sequentialUsed ? (
          <Trans>Sequential testing lets it be decided early.</Trans>
        ) : (
          <Trans>Its results are strong enough to decide early.</Trans>
        )}
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
                {criteriaName !== undefined ? (
                  status.status === "ship-now" ? (
                    <Trans>
                      No rule in {criteriaName} matched, so it ships by default.
                    </Trans>
                  ) : status.status === "ready-for-review" ? (
                    <Trans>
                      No rule in {criteriaName} matched, so the call is yours.
                    </Trans>
                  ) : (
                    <Trans>
                      No rule in {criteriaName} matched, so it rolls back by
                      default.
                    </Trans>
                  )
                ) : status.status === "ship-now" ? (
                  <Trans>
                    No rule in your decision criteria matched, so it ships by
                    default.
                  </Trans>
                ) : status.status === "ready-for-review" ? (
                  <Trans>
                    No rule in your decision criteria matched, so the call is
                    yours.
                  </Trans>
                ) : (
                  <Trans>
                    No rule in your decision criteria matched, so it rolls back
                    by default.
                  </Trans>
                )}
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
            <Trans>Caution:</Trans>
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
              <Trans>View decision criteria</Trans>
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
