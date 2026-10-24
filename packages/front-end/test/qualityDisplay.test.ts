import {
  formatAIScore,
  getScoreTier,
} from "@/components/Experiment/Quality/qualityDisplay";

describe("getScoreTier", () => {
  it("is green from 80, amber from 50, red below", () => {
    expect(getScoreTier(100)).toBe("green");
    expect(getScoreTier(80)).toBe("green");
    expect(getScoreTier(79.9)).toBe("amber");
    expect(getScoreTier(50)).toBe("amber");
    expect(getScoreTier(49.9)).toBe("red");
    expect(getScoreTier(0)).toBe("red");
  });
});

describe("formatAIScore", () => {
  it("shows a 0-1 verdict as a whole percentage", () => {
    expect(formatAIScore(0)).toBe("0%");
    expect(formatAIScore(1)).toBe("100%");
    expect(formatAIScore(0.666)).toBe("67%");
    expect(formatAIScore(0.5)).toBe("50%");
  });
});
