import type { CustomQualityCheckJudge } from "../validators/experiment-quality-score";

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
type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type QualityDecisionQuestion =
  | NoulQuestion
  | ScoreQuestion
  | ChoiceQuestion;
export type QualityDecisionAnswer =
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; probabilities: Record<string, number> }
  | { type: "choice"; choice: string; confidence: number };

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

// An org's own guidance for a check becomes one more judgment in it
const MEETS_GUIDANCE = "the organization's guidance";

const CUSTOM_RULE_LEVELS: ScoreQuestion["criteria"] = [
  "Doesn't meet the rule",
  "Partly meets the rule",
  "Fully meets the rule",
];

export function buildQualityDecisionRequest({
  hypothesis,
  goalMetricNames,
  hypothesisGuidance,
  alignmentGuidance,
  builtInChecks = true,
  customChecks = [],
  experimentDigest = "",
}: {
  hypothesis: string;
  goalMetricNames: string[];
  hypothesisGuidance?: string;
  alignmentGuidance?: string;
  // False when only custom rules are judged here
  builtInChecks?: boolean;
  // Custom AI rules routed to the decision model, keyed by result key
  customChecks?: { key: string; rule: string }[];
  // The experiment data custom rules are judged against (JSON)
  experimentDigest?: string;
}): {
  state: Record<string, string | string[]>;
  questions: Record<string, QualityDecisionQuestion>;
} {
  const state: Record<string, string | string[]> = {
    hypothesis,
    goalMetrics: goalMetricNames,
  };
  const questions: Record<string, QualityDecisionQuestion> = {};
  for (const { key, rule } of customChecks) {
    questions[key] = {
      type: "score",
      instructions: `How well does \`experiment\` meet this rule? ${rule}`,
      criteria: CUSTOM_RULE_LEVELS,
    };
  }
  if (customChecks.length) state.experiment = experimentDigest;
  if (!builtInChecks) return { state, questions };

  for (const [key, part] of Object.entries(HYPOTHESIS_PARTS)) {
    questions[key] = part.question;
  }
  if (hypothesisGuidance) {
    state.hypothesisGuidance = hypothesisGuidance;
    questions.hypothesisGuidance = {
      type: "noul",
      instructions: `Does \`hypothesis\` meet ${MEETS_GUIDANCE} on a good hypothesis in \`hypothesisGuidance\`?`,
    };
  }
  if (goalMetricNames.length) {
    questions.alignment = {
      type: "score",
      instructions:
        "How directly do `goalMetrics` measure the outcome that `hypothesis` predicts?",
      criteria: ALIGNMENT_LEVELS,
    };
    if (alignmentGuidance) {
      state.alignmentGuidance = alignmentGuidance;
      questions.alignmentGuidance = {
        type: "noul",
        instructions: `Do \`goalMetrics\` follow ${MEETS_GUIDANCE} on goal metrics in \`alignmentGuidance\`?`,
      };
    }
  }
  return { state, questions };
}

type Verdict = { score: number; reason: string };

// By check key: the built-in checks that were asked (alignment needs goal
// metrics) and custom rules by their `custom:<id>` key
export type QualityDecisionVerdicts = {
  "ai-hypothesis-quality"?: Verdict;
  "ai-hypothesis-metric-alignment"?: Verdict;
} & Partial<Record<string, Verdict>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

const mostLikelyLevel = (probabilities: Record<string, number>) =>
  Number(Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0]);

// 0-1 verdicts in the same shape as the AI judge's, from the answers to
// buildQualityDecisionRequest's questions
export function interpretQualityDecisions(
  answers: Record<string, QualityDecisionAnswer | undefined>,
  {
    builtInChecks = true,
    customKeys = [],
  }: { builtInChecks?: boolean; customKeys?: string[] } = {},
): QualityDecisionVerdicts {
  const verdicts: QualityDecisionVerdicts = {};
  for (const key of customKeys) {
    const answer = answers[key];
    if (answer?.type !== "score") continue;
    const level = mostLikelyLevel(answer.probabilities);
    verdicts[key] = {
      score: round2(answer.score / (CUSTOM_RULE_LEVELS.length - 1)),
      reason: CUSTOM_RULE_LEVELS[level] ?? CUSTOM_RULE_LEVELS[0],
    };
  }
  if (!builtInChecks) return verdicts;

  const yes = (key: string) => {
    const answer = answers[key];
    return answer?.type === "noul" ? answer.noul : 0;
  };
  const parts = [
    ...Object.entries(HYPOTHESIS_PARTS).map(([key, part]) => ({
      yes: yes(key),
      missing: part.missing,
    })),
    ...(answers.hypothesisGuidance
      ? [
          {
            yes: yes("hypothesisGuidance"),
            missing: `doesn't meet ${MEETS_GUIDANCE}`,
          },
        ]
      : []),
  ];
  const missing = parts.filter((p) => p.yes < YES).map((p) => p.missing);
  verdicts["ai-hypothesis-quality"] = {
    score: round2(parts.reduce((sum, p) => sum + p.yes, 0) / parts.length),
    reason: missing.length
      ? `The hypothesis ${missing.join(", ")}`
      : "Names the change, predicts an effect and explains why",
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
    const levelScore = alignment.score / (ALIGNMENT_LEVELS.length - 1);
    const levelReason =
      ALIGNMENT_REASONS[mostLikelyLevel(alignment.probabilities)] ??
      ALIGNMENT_REASONS[0];
    const guided = !!answers.alignmentGuidance;
    const followsGuidance = yes("alignmentGuidance");
    verdicts["ai-hypothesis-metric-alignment"] = {
      score: round2(guided ? (levelScore + followsGuidance) / 2 : levelScore),
      reason:
        guided && followsGuidance < YES
          ? `${levelReason}, and they don't follow ${MEETS_GUIDANCE}`
          : levelReason,
    };
  }
  return verdicts;
}

// Choosing a custom rule's judge. Jev is reliable for judgments about
// meaning, but not for counting, arithmetic or dates, which go to the chat
// model; so does anything Jev isn't confident about.
const JUDGE_CONFIDENCE = 0.6;

export function buildCustomCheckJudgeRequest(rule: string): {
  state: { rule: string };
  questions: Record<string, QualityDecisionQuestion>;
} {
  return {
    state: { rule },
    questions: {
      judge: {
        type: "choice",
        instructions:
          "What does checking an experiment's details against `rule` take?",
        criteria: {
          decision:
            "A judgment about meaning or quality, answered yes/no or as a degree from what the details say",
          llm: "Counting, arithmetic, points, comparing dates or numbers, or several steps of reasoning",
        },
      },
    },
  };
}

export function interpretCustomCheckJudge(
  answer: QualityDecisionAnswer | undefined,
): CustomQualityCheckJudge {
  return answer?.type === "choice" &&
    answer.choice === "decision" &&
    answer.confidence >= JUDGE_CONFIDENCE
    ? "decision"
    : "llm";
}
