import type { ExperimentInterface } from "shared/types/experiment";
import { getMaxExperimentDurationAnchor } from "../src/experiments/maxExperimentDuration";

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

describe("getMaxExperimentDurationAnchor", () => {
  it("uses first bandit event date for MAB in exploit (not banditStageDateStarted)", () => {
    const exploreStart = new Date("2025-01-01T12:00:00.000Z");
    const anchor = getMaxExperimentDurationAnchor(baseBandit());
    expect(anchor?.toISOString()).toBe(exploreStart.toISOString());
  });

  it("uses banditStageDateStarted for MAB in explore when there are no events yet", () => {
    const exploreStart = new Date("2025-03-10T00:00:00.000Z");
    const anchor = getMaxExperimentDurationAnchor(
      baseBandit({
        banditStage: "explore",
        banditStageDateStarted: exploreStart,
        phases: [
          {
            dateStarted: new Date("2025-03-01"),
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
      }),
    );
    expect(anchor?.toISOString()).toBe(exploreStart.toISOString());
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
