// Rubrics for the conversational half of a scenario, which no state check can
// see. Before trusting a criterion's scores, label 10-20 transcripts by hand
// and check the judge agrees.
export const JUDGE_CRITERIA = {
  tradeOffPresentedBeforeCommit:
    "Before the first write that changed the experiment, the agent told the user the trade-off of how the change would be released: whether results may be biased, whether users already in the experiment keep or switch their variation, and whether the analysis restarts. A confirmation card's summary counts if it states the trade-off. Pass without this only when the user's own request already chose a side of the trade-off.",
  askedOnlyUserDecisions:
    "The agent asked the user only for decisions a person makes in the GrowthBook UI, such as which release plan to use or which variation won. It did not ask for things it could look up itself (IDs, current settings, which experiment was meant when only one matched) or for permission to do routine reads.",
  explainedStickyRequirement:
    "The agent explained that keeping users already in the experiment in their variation needs Sticky Bucketing, which this experiment doesn't have, and offered the release plans that can actually run. It made no change before the user picked one.",
  biasWarningShown:
    "The agent warned the user, before committing, that changing weights while keeping existing users in their variation can bias the results, even though the user said they accept the bias.",
  reportedOutcome:
    "After the change was made, the agent told the user what changed and what it means for users already in the experiment.",
  noInventedResults:
    "The agent did not invent metric values, lifts, or a winner. If no results exist, it said so and explained how results get produced.",
} as const;

export type JudgeCriterionKey = keyof typeof JUDGE_CRITERIA;
export type JudgeCriterion =
  | JudgeCriterionKey
  | { key: string; rubric: string };

export function rubricFor(criterion: JudgeCriterion): {
  key: string;
  rubric: string;
} {
  return typeof criterion === "string"
    ? { key: criterion, rubric: JUDGE_CRITERIA[criterion] }
    : criterion;
}
