import { DecisionCriteriaData } from "shared/types/experiment";

// Default decision criteria for new users
export const PRESET_DECISION_CRITERIA: DecisionCriteriaData = {
  id: "gbdeccrit_strictrollout",
  name: "Clear Signals",
  description:
    "Ship only with clear goal metric successes and no guardrail failures.",
  rules: [
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
          metrics: "guardrails",
          direction: "statsigLoser",
        },
      ],
      action: "rollback",
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

export const DO_NO_HARM_DECISION_CRITERIA: DecisionCriteriaData = {
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

export const PRESET_DECISION_CRITERIAS: DecisionCriteriaData[] = [
  PRESET_DECISION_CRITERIA,
  DO_NO_HARM_DECISION_CRITERIA,
];
