import { describe, expect, it } from "vitest";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  formatDateRangeForDisplay,
  getDateRangeDurationInDays,
  getPhaseDateRangeForDisplay,
  getRuntimeRangeForSelectedPhase,
  getTotalRuntimeRange,
} from "@/services/experimentDateRanges";

const phaseVariationPair = [
  { id: "0", status: "active" as const },
  { id: "1", status: "active" as const },
];

const variationPair = [
  { id: "0", key: "0", name: "Control", screenshots: [] },
  { id: "1", key: "1", name: "Variation", screenshots: [] },
];

const makeExperiment = (
  overrides: Partial<ExperimentInterfaceStringDates>,
): ExperimentInterfaceStringDates => {
  return {
    status: "draft",
    type: "standard",
    phases: [],
    ...overrides,
  } as unknown as ExperimentInterfaceStringDates;
};

describe("experimentDateRanges", () => {
  it("does not show runtime for draft experiments", () => {
    const experiment = makeExperiment({
      status: "draft",
      phases: [
        {
          name: "Main",
          dateStarted: "2026-02-26T10:00:00.000Z",
          reason: "",
          coverage: 1,
          variationWeights: [0.5, 0.5],
          condition: "",
          savedGroups: [],
          prerequisites: [],
          variations: phaseVariationPair,
        },
      ],
    });

    expect(
      getRuntimeRangeForSelectedPhase({
        experiment,
      }),
    ).toBeNull();
    expect(
      getTotalRuntimeRange({
        experiment,
      }),
    ).toBeNull();
  });

  it("returns selected phase runtime range when experiment has started", () => {
    const experiment = makeExperiment({
      status: "running",
      phases: [
        {
          name: "Main",
          dateStarted: "2026-02-26T10:00:00.000Z",
          dateEnded: "2026-03-01T10:00:00.000Z",
          reason: "",
          coverage: 1,
          variationWeights: [0.5, 0.5],
          condition: "",
          savedGroups: [],
          prerequisites: [],
          variations: phaseVariationPair,
        },
        {
          name: "Phase 2",
          dateStarted: "2026-03-01T10:00:00.000Z",
          reason: "",
          coverage: 1,
          variationWeights: [0.5, 0.5],
          condition: "",
          savedGroups: [],
          prerequisites: [],
          variations: phaseVariationPair,
        },
      ],
    });

    const selectedRange = getRuntimeRangeForSelectedPhase({
      experiment,
      selectedPhase: 0,
    });

    expect(selectedRange).toEqual({
      startDate: "2026-02-26T10:00:00.000Z",
      endDate: "2026-03-01T10:00:00.000Z",
    });
  });

  it("uses holdout analysis start date for holdout phase display", () => {
    const range = getPhaseDateRangeForDisplay({
      phase: {
        name: "Analysis",
        reason: "",
        lookbackStartDate: new Date("2026-02-20T00:00:00.000Z"),
        dateStarted: "2026-02-26T00:00:00.000Z",
        dateEnded: "2026-03-03T00:00:00.000Z",
        coverage: 1,
        variationWeights: [0.5, 0.5],
        condition: "",
        savedGroups: [],
        prerequisites: [],
        variations: phaseVariationPair,
      },
      isHoldout: true,
      holdoutAnalysisStartDate: "2026-02-24T00:00:00.000Z",
    });

    expect(range).toEqual({
      startDate: "2026-02-24T00:00:00.000Z",
      endDate: "2026-03-03T00:00:00.000Z",
    });
  });

  it("formats date ranges and computes duration", () => {
    const range = {
      startDate: "2026-02-01T00:00:00.000Z",
      endDate: "2026-02-03T00:00:00.000Z",
    };

    expect(formatDateRangeForDisplay(range)).toContain("2026");
    expect(getDateRangeDurationInDays(range)).toBe(2);
  });
});
