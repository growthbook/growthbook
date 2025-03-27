import { DecisionCriteriaData } from "back-end/types/experiment";

// Default decision criteria for new users
export const DEFAULT_DECISION_CRITERIA: DecisionCriteriaData = {
  id: "gbdeccrit_strictrollout",
  name: "Clear Signals",
  description:
    "Only ship with clear goal metric signals and no guardrail failure.",
  rules: [
    {
      conditions: [
        {
          match: "any",
          metrics: "guardrails",
          direction: "statsigLoser",
        },
      ],
      action: "rollback",
    },
    {
      conditions: [
        {
          match: "all",
          metrics: "goals",
          direction: "statsigWinner",
        },
        {
          match: "none",
          metrics: "guardrails",
          direction: "statsigLoser",
        },
      ],
      action: "ship",
    },
    {
      conditions: [
        {
          match: "any",
          metrics: "goals",
          direction: "statsigLoser",
        },
        {
          match: "none",
          metrics: "goals",
          direction: "statsigWinner",
        },
      ],
      action: "rollback",
    },
  ],
  defaultAction: "review",
};

const secondaryDecisionCriteria: DecisionCriteriaData = {
  id: "gbdeccrit_donoharm",
  name: "Do No Harm",
  description:
    "Ship so long as no guardrails and no goal metrics are failing. Useful if the costs of shipping are very low.",
  rules: [
    {
      conditions: [
        {
          match: "none",
          metrics: "goals",
          direction: "statsigLoser",
        },
        {
          match: "none",
          metrics: "guardrails",
          direction: "statsigLoser",
        },
      ],
      action: "ship",
    },
  ],
  defaultAction: "rollback",
};

export const DEFAULT_DECISION_CRITERIAS: DecisionCriteriaData[] = [
  DEFAULT_DECISION_CRITERIA,
  secondaryDecisionCriteria,
];
