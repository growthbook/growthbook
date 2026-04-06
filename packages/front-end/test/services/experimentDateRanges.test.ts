import { describe, expect, it } from "vitest";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  formatDateRangeForDisplay,
  getDateRangeDurationInDays,
  getPhaseDateRangeForDisplay,
  getRuntimeRangeForSelectedPhase,
  getTotalRuntimeRange,
} from "@/services/experimentDateRanges";

const baseExperiment: ExperimentInterfaceStringDates = {
  id: "exp_1",
  organization: "org_1",
  owner: "user_1",
  dateCreated: "2026-02-26T10:00:00.000Z",
  dateUpdated: "2026-02-26T10:00:00.000Z",
  project: "",
  datasource: "",
  userIdType: "user",
  status: "draft",
  archived: false,
  type: "standard",
  name: "Test Experiment",
  hypothesis: "",
  description: "",
  variations: [
    { id: "0", key: "0", name: "Control" },
    { id: "1", key: "1", name: "Variation" },
  ],
  phases: [],
  metrics: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  tags: [],
  results: "inconclusive",
};

describe("experimentDateRanges", () => {
  it("does not show runtime for draft experiments", () => {
    const experiment: ExperimentInterfaceStringDates = {
      ...baseExperiment,
      status: "draft",
      phases: [
        {
          name: "Main",
          dateStarted: "2026-02-26T10:00:00.000Z",
          coverage: 1,
          variationWeights: [0.5, 0.5],
          condition: "",
          savedGroups: [],
          prerequisites: [],
          variations: [
            { id: "0", status: "active" },
            { id: "1", status: "active" },
          ],
        },
      ],
    };

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
    const experiment: ExperimentInterfaceStringDates = {
      ...baseExperiment,
      status: "running",
      phases: [
        {
          name: "Main",
          dateStarted: "2026-02-26T10:00:00.000Z",
          dateEnded: "2026-03-01T10:00:00.000Z",
          coverage: 1,
          variationWeights: [0.5, 0.5],
          condition: "",
          savedGroups: [],
          prerequisites: [],
          variations: [
            { id: "0", status: "active" },
            { id: "1", status: "active" },
          ],
        },
        {
          name: "Phase 2",
          dateStarted: "2026-03-01T10:00:00.000Z",
          coverage: 1,
          variationWeights: [0.5, 0.5],
          condition: "",
          savedGroups: [],
          prerequisites: [],
          variations: [
            { id: "0", status: "active" },
            { id: "1", status: "active" },
          ],
        },
      ],
    };

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
        lookbackStartDate: "2026-02-20T00:00:00.000Z",
        dateStarted: "2026-02-26T00:00:00.000Z",
        dateEnded: "2026-03-03T00:00:00.000Z",
        coverage: 1,
        variationWeights: [0.5, 0.5],
        condition: "",
        savedGroups: [],
        prerequisites: [],
        variations: [
          { id: "0", status: "active" },
          { id: "1", status: "active" },
        ],
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
