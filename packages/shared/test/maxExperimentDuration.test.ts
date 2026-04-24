import type { ExperimentInterface } from "shared/types/experiment";
import {
  formatMaxExperimentDuration,
  nominalMaxExperimentDurationMs,
  formatTargetSampleSize,
  getCalendarDaysRemainingUntilMaxExperimentEnd,
  getMaxExperimentDurationAnchor,
  isTargetSampleSizeReached,
  MIGRATED_RUNNING_EXPERIMENT_MAX_DURATION,
} from "../src/experiments/maxExperimentDuration";

function baseBandit(
  overrides: Partial<
    Pick<ExperimentInterface, "banditStage" | "banditStageDateStarted">
  > & {
    phases?: ExperimentInterface["phases"];
  } = {},
): Pick<
  ExperimentInterface,
  "phases" | "type" | "banditStage" | "banditStageDateStarted"
> {
  const exploreStart = new Date("2025-01-01T12:00:00.000Z");
  const exploitStart = new Date("2025-02-01T12:00:00.000Z");
  return {
    type: "multi-armed-bandit",
    banditStage: "exploit",
    banditStageDateStarted: exploitStart,
    phases: [
      {
        dateStarted: new Date("2024-12-01"),
        name: "Main",
        reason: "",
        coverage: 1,
        condition: "",
        variationWeights: [0.5, 0.5],
        variations: [
          { id: "0", status: "active" },
          { id: "1", status: "active" },
        ],
        banditEvents: [
          {
            date: exploreStart,
            banditResult: {
              currentWeights: [0.5, 0.5],
              updatedWeights: [0.5, 0.5],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("nominalMaxExperimentDurationMs", () => {
  it("uses fixed 24h days and 7-day weeks (independent of local DST)", () => {
    expect(nominalMaxExperimentDurationMs({ value: 1, unit: "days" })).toBe(
      86_400_000,
    );
    expect(nominalMaxExperimentDurationMs({ value: 1, unit: "weeks" })).toBe(
      7 * 86_400_000,
    );
    expect(nominalMaxExperimentDurationMs({ value: 3, unit: "hours" })).toBe(
      3 * 3_600_000,
    );
  });
});

describe("formatMaxExperimentDuration", () => {
  it("shows days for multi-day windows from days or weeks", () => {
    expect(formatMaxExperimentDuration({ value: 91, unit: "days" })).toBe(
      "91 days",
    );
    expect(formatMaxExperimentDuration({ value: 2, unit: "weeks" })).toBe(
      "14 days",
    );
  });

  it("shows hours when the window is under 24 hours", () => {
    expect(formatMaxExperimentDuration({ value: 1, unit: "hours" })).toBe(
      "1 hour",
    );
    expect(formatMaxExperimentDuration({ value: 12, unit: "hours" })).toBe(
      "12 hours",
    );
    expect(formatMaxExperimentDuration({ value: 23, unit: "hours" })).toBe(
      "23 hours",
    );
  });

  it("shows days at exactly 24 hours or more", () => {
    expect(formatMaxExperimentDuration({ value: 24, unit: "hours" })).toBe(
      "1 day",
    );
    expect(formatMaxExperimentDuration({ value: 1, unit: "days" })).toBe(
      "1 day",
    );
    expect(formatMaxExperimentDuration({ value: 36, unit: "hours" })).toBe(
      "2 days",
    );
  });

  it("returns em dash when duration is missing", () => {
    expect(formatMaxExperimentDuration(undefined)).toBe("—");
    expect(formatMaxExperimentDuration(null)).toBe("—");
  });

  it("formats target sample size", () => {
    expect(formatTargetSampleSize(undefined)).toBe("—");
    const s = formatTargetSampleSize(5000);
    expect(s.replace(/\D/g, "")).toContain("5000");
  });

  it("formats migrated running default in whole days", () => {
    expect(
      formatMaxExperimentDuration(MIGRATED_RUNNING_EXPERIMENT_MAX_DURATION),
    ).toBe(`${MIGRATED_RUNNING_EXPERIMENT_MAX_DURATION.value} days`);
  });
});

describe("getMaxExperimentDurationAnchor", () => {
  it("returns null for multi-armed-bandit experiments", () => {
    expect(getMaxExperimentDurationAnchor(baseBandit())).toBeNull();
  });

  it("uses latest phase dateStarted for standard experiments", () => {
    const phaseStart = new Date("2025-06-01T08:00:00.000Z");
    const anchor = getMaxExperimentDurationAnchor({
      type: "standard",
      phases: [
        {
          dateStarted: phaseStart,
          name: "Main",
          reason: "",
          coverage: 1,
          condition: "",
          variationWeights: [0.5, 0.5],
          variations: [
            { id: "0", status: "active" },
            { id: "1", status: "active" },
          ],
        },
      ],
    });
    expect(anchor?.toISOString()).toBe(phaseStart.toISOString());
  });
});

describe("getCalendarDaysRemainingUntilMaxExperimentEnd", () => {
  it("returns whole days remaining (exact day boundaries)", () => {
    const phaseStart = new Date("2025-01-01T00:00:00.000Z");
    const now = new Date("2025-01-08T00:00:00.000Z");
    const d = getCalendarDaysRemainingUntilMaxExperimentEnd(
      {
        type: "standard",
        phases: [
          {
            dateStarted: phaseStart,
            name: "Main",
            reason: "",
            coverage: 1,
            condition: "",
            variationWeights: [0.5, 0.5],
            variations: [
              { id: "0", status: "active" },
              { id: "1", status: "active" },
            ],
          },
        ],
        maxExperimentDuration: { value: 14, unit: "days" },
      },
      now,
    );
    expect(d).toBe(7);
  });

  it("rounds up when less than a full day remains", () => {
    const phaseStart = new Date("2025-01-01T00:00:00.000Z");
    const end = new Date("2025-01-15T00:00:00.000Z");
    const now = new Date("2025-01-14T12:00:00.000Z");
    const msLeft = end.getTime() - now.getTime();
    expect(msLeft).toBeLessThan(86_400_000);
    const d = getCalendarDaysRemainingUntilMaxExperimentEnd(
      {
        type: "standard",
        phases: [
          {
            dateStarted: phaseStart,
            name: "Main",
            reason: "",
            coverage: 1,
            condition: "",
            variationWeights: [0.5, 0.5],
            variations: [
              { id: "0", status: "active" },
              { id: "1", status: "active" },
            ],
          },
        ],
        maxExperimentDuration: { value: 14, unit: "days" },
      },
      now,
    );
    expect(d).toBe(1);
  });

  it("returns null when max duration is omitted", () => {
    expect(
      getCalendarDaysRemainingUntilMaxExperimentEnd(
        {
          type: "standard",
          phases: [
            {
              dateStarted: new Date("2025-01-01"),
              name: "Main",
              reason: "",
              coverage: 1,
              condition: "",
              variationWeights: [0.5, 0.5],
              variations: [
                { id: "0", status: "active" },
                { id: "1", status: "active" },
              ],
            },
          ],
        },
        new Date("2025-01-05"),
      ),
    ).toBeNull();
  });

  it("returns null for multi-armed-bandit even if max duration is set", () => {
    expect(
      getCalendarDaysRemainingUntilMaxExperimentEnd(
        {
          ...baseBandit(),
          maxExperimentDuration: { value: 14, unit: "days" },
        },
        new Date("2025-01-05"),
      ),
    ).toBeNull();
  });
});

describe("isTargetSampleSizeReached", () => {
  const base = {
    type: "standard" as const,
    phases: [
      {
        dateStarted: new Date("2025-01-01"),
        name: "Main",
        reason: "",
        coverage: 1,
        condition: "",
        variationWeights: [0.5, 0.5],
        variations: [
          { id: "0", status: "active" as const },
          { id: "1", status: "active" as const },
        ],
      },
    ],
    targetSampleSize: 100,
  };

  it("is false when below cap or no cap", () => {
    expect(isTargetSampleSizeReached(base, 99)).toBe(false);
    expect(
      isTargetSampleSizeReached(
        { ...base, targetSampleSize: undefined },
        1_000_000,
      ),
    ).toBe(false);
  });

  it("is true at or above cap", () => {
    expect(isTargetSampleSizeReached(base, 100)).toBe(true);
    expect(isTargetSampleSizeReached(base, 101)).toBe(true);
  });

  it("is false for bandit", () => {
    expect(
      isTargetSampleSizeReached(
        {
          ...baseBandit(),
          targetSampleSize: 10,
        },
        1000,
      ),
    ).toBe(false);
  });
});
