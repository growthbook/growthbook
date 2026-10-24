import {
  buildQualityDecisionRequest,
  interpretQualityDecisions,
} from "../../src/enterprise/experimentQualityDecisions";

const noul = (yes: number) => ({ type: "noul" as const, noul: yes });

describe("buildQualityDecisionRequest", () => {
  it("asks about each part of the hypothesis, and alignment only with goal metrics", () => {
    const withMetrics = buildQualityDecisionRequest({
      hypothesis: "h",
      goalMetricNames: ["Signups"],
    });
    expect(withMetrics.state).toEqual({
      hypothesis: "h",
      goalMetrics: ["Signups"],
    });
    expect(Object.keys(withMetrics.questions)).toEqual([
      "namesChange",
      "predictsEffect",
      "givesReason",
      "alignment",
    ]);
    expect(
      Object.keys(
        buildQualityDecisionRequest({ hypothesis: "h", goalMetricNames: [] })
          .questions,
      ),
    ).not.toContain("alignment");
  });
});

describe("buildQualityDecisionRequest with guidance", () => {
  it("adds the organization's guidance as one more judgment per check", () => {
    const { state, questions } = buildQualityDecisionRequest({
      hypothesis: "h",
      goalMetricNames: ["Signups"],
      hypothesisGuidance: "Name the user segment",
      alignmentGuidance: "Prefer revenue metrics",
    });
    expect(state).toMatchObject({
      hypothesisGuidance: "Name the user segment",
      alignmentGuidance: "Prefer revenue metrics",
    });
    expect(questions.hypothesisGuidance?.type).toBe("noul");
    expect(questions.alignmentGuidance?.type).toBe("noul");
  });
});

describe("interpretQualityDecisions", () => {
  it("averages the hypothesis parts and names the ones that are missing", () => {
    const verdicts = interpretQualityDecisions({
      namesChange: noul(0.9),
      predictsEffect: noul(0.2),
      givesReason: noul(0.1),
    });
    expect(verdicts["ai-hypothesis-quality"]).toEqual({
      score: 0.4,
      reason:
        "The hypothesis doesn't predict a specific effect, doesn't explain why",
    });
    expect(verdicts["ai-hypothesis-metric-alignment"]).toBeUndefined();
  });

  it("scales alignment to 0-1 and explains the most likely level", () => {
    const verdicts = interpretQualityDecisions({
      namesChange: noul(1),
      predictsEffect: noul(1),
      givesReason: noul(1),
      alignment: {
        type: "score",
        score: 1.5,
        probabilities: { "0": 0, "1": 0.5, "2": 0.5 },
      },
    });
    expect(verdicts["ai-hypothesis-quality"]).toEqual({
      score: 1,
      reason: "Names the change, predicts an effect and explains why",
    });
    expect(verdicts["ai-hypothesis-metric-alignment"]?.score).toBe(0.75);
  });

  it("fails alignment when the hypothesis predicts nothing to measure", () => {
    const verdicts = interpretQualityDecisions({
      namesChange: noul(0.9),
      predictsEffect: noul(0.1),
      givesReason: noul(0.1),
      alignment: {
        type: "score",
        score: 2,
        probabilities: { "0": 0, "1": 0, "2": 1 },
      },
    });
    expect(verdicts["ai-hypothesis-metric-alignment"]).toEqual({
      score: 0,
      reason: "The hypothesis doesn't predict an outcome to measure",
    });
  });

  it("folds guidance answers into both checks", () => {
    const verdicts = interpretQualityDecisions({
      namesChange: noul(1),
      predictsEffect: noul(1),
      givesReason: noul(1),
      hypothesisGuidance: noul(0),
      alignment: {
        type: "score",
        score: 2,
        probabilities: { "0": 0, "1": 0, "2": 1 },
      },
      alignmentGuidance: noul(0),
    });
    expect(verdicts["ai-hypothesis-quality"]).toEqual({
      score: 0.75,
      reason: "The hypothesis doesn't meet the organization's guidance",
    });
    expect(verdicts["ai-hypothesis-metric-alignment"]).toEqual({
      score: 0.5,
      reason:
        "A goal metric directly measures the predicted outcome, and they don't follow the organization's guidance",
    });
  });

  it("treats missing answers as no", () => {
    expect(interpretQualityDecisions({})["ai-hypothesis-quality"].score).toBe(
      0,
    );
  });
});
