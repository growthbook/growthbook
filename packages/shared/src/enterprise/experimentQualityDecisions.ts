// Built-in AI quality checks as decision-model questions (TypeSafe's System
// One API, served by Jev and compatible models). Each check is split into
// narrow judgments that are combined in code, so a failing score comes with
// the specific part that failed.

// The fields of a System One request and answer these checks use
type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};
type ScoreQuestion = {
  type: "score";
  instructions: string;
  // Levels from low to high; the API needs at least two
  criteria: readonly [string, string, ...string[]];
};
export type QualityDecisionQuestion = NoulQuestion | ScoreQuestion;
export type QualityDecisionAnswer =
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; probabilities: Record<string, number> };

// Parts of a good hypothesis, each judged on its own
const HYPOTHESIS_PARTS = {
  namesChange: {
    question: {
      type: "noul",
      instructions:
        "Does `hypothesis` say what will be changed in the product or experience?",
      criteria: {
        true: "Names a concrete change, such as a new design, copy, flow, price or feature",
        false: "Doesn't say what will be changed, or only names a goal",
      },
    },
    missing: "doesn't say what will change",
  },
  predictsEffect: {
    question: {
      type: "noul",
      instructions:
        "Does `hypothesis` predict how user behavior or a measurable outcome will change?",
      criteria: {
        true: "States an expected effect with a direction, such as more signups or fewer drop-offs",
        false:
          "Only describes the change, or the expected effect is vague, like a better experience",
      },
    },
    missing: "doesn't predict a specific effect",
  },
  givesReason: {
    question: {
      type: "noul",
      instructions:
        "Does `hypothesis` give a reason why the change should cause the effect?",
      criteria: {
        true: "Explains the expected cause, such as reducing friction or making something easier to find",
        false: "Gives no reason for the expected effect",
      },
    },
    missing: "doesn't explain why",
  },
} satisfies Record<string, { question: NoulQuestion; missing: string }>;

const ALIGNMENT_LEVELS: ScoreQuestion["criteria"] = [
  "None of the goal metrics measure the outcome the hypothesis predicts",
  "A goal metric measures a related or indirect outcome",
  "A goal metric directly measures the outcome the hypothesis predicts",
];

const ALIGNMENT_REASONS = [
  "The goal metrics don't measure the predicted outcome",
  "The goal metrics measure it only indirectly",
  "A goal metric directly measures the predicted outcome",
];

// A judgment counts as "yes" from this probability
const YES = 0.5;

export function buildQualityDecisionRequest({
  hypothesis,
  goalMetricNames,
}: {
  hypothesis: string;
  goalMetricNames: string[];
}): {
  state: { hypothesis: string; goalMetrics: string[] };
  questions: Record<string, QualityDecisionQuestion>;
} {
  const questions: Record<string, QualityDecisionQuestion> = Object.fromEntries(
    Object.entries(HYPOTHESIS_PARTS).map(([key, part]) => [key, part.question]),
  );
  if (goalMetricNames.length) {
    questions.alignment = {
      type: "score",
      instructions:
        "How directly do `goalMetrics` measure the outcome that `hypothesis` predicts?",
      criteria: ALIGNMENT_LEVELS,
    };
  }
  return { state: { hypothesis, goalMetrics: goalMetricNames }, questions };
}

export interface QualityDecisionVerdicts {
  "ai-hypothesis-quality": { score: number; reason: string };
  // Absent when the experiment has no goal metrics
  "ai-hypothesis-metric-alignment"?: { score: number; reason: string };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// 0-1 verdicts in the same shape as the AI judge's, from the answers to
// buildQualityDecisionRequest's questions
export function interpretQualityDecisions(
  answers: Record<string, QualityDecisionAnswer | undefined>,
): QualityDecisionVerdicts {
  const parts = Object.entries(HYPOTHESIS_PARTS).map(([key, part]) => {
    const answer = answers[key];
    return {
      yes: answer?.type === "noul" ? answer.noul : 0,
      missing: part.missing,
    };
  });
  const missing = parts.filter((p) => p.yes < YES).map((p) => p.missing);
  const verdicts: QualityDecisionVerdicts = {
    "ai-hypothesis-quality": {
      score: round2(parts.reduce((sum, p) => sum + p.yes, 0) / parts.length),
      reason: missing.length
        ? `The hypothesis ${missing.join(", ")}`
        : "Names the change, predicts an effect and explains why",
    },
  };

  const alignment = answers.alignment;
  const predictsEffect = answers.predictsEffect;
  if (
    alignment &&
    !(predictsEffect?.type === "noul" && predictsEffect.noul >= YES)
  ) {
    // Without a prediction there's nothing for the metrics to measure; the
    // model otherwise matches metrics to the topic of the change
    verdicts["ai-hypothesis-metric-alignment"] = {
      score: 0,
      reason: "The hypothesis doesn't predict an outcome to measure",
    };
  } else if (alignment?.type === "score") {
    const level = Object.entries(alignment.probabilities).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
    verdicts["ai-hypothesis-metric-alignment"] = {
      score: round2(alignment.score / (ALIGNMENT_LEVELS.length - 1)),
      reason: ALIGNMENT_REASONS[Number(level)] ?? ALIGNMENT_REASONS[0],
    };
  }
  return verdicts;
}
