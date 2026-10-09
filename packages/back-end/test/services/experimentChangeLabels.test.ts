import type { ExperimentInterface, ExperimentPhase } from "shared/validators";
import { experimentChangeLabels } from "back-end/src/services/confirmations";

const phase = (overrides: Partial<ExperimentPhase> = {}): ExperimentPhase => ({
  dateStarted: new Date("2026-01-01"),
  name: "Main",
  reason: "",
  coverage: 1,
  condition: "",
  variationWeights: [0.5, 0.5],
  variations: [],
  ...overrides,
});
const running = {
  status: "running",
  phases: [phase({ name: "First" }), phase()],
} as unknown as ExperimentInterface;

describe("experimentChangeLabels", () => {
  it("names Make Changes edits to the live phase", () => {
    expect(
      experimentChangeLabels(running, {
        phases: [
          phase({ name: "First" }),
          phase({
            coverage: 0.5,
            variationWeights: [0.3, 0.7],
            condition: '{"country":"US"}',
          }),
        ],
      }).sort(),
    ).toEqual(["experiment.targeting", "experiment.traffic"]);
  });

  it("names a new phase, a re-randomize and edits to past phases or dates", () => {
    expect(
      experimentChangeLabels(running, {
        bucketVersion: 2,
        phases: [
          phase({ name: "First", dateStarted: new Date("2025-12-01") }),
          phase(),
          phase({ name: "Next" }),
        ],
      }).sort(),
    ).toEqual(["experiment.phases"]);
  });

  it("ignores echoed fields, and counts only status on a draft", () => {
    expect(
      experimentChangeLabels(running, {
        phases: [phase({ name: "First", savedGroups: [] }), phase()],
      }),
    ).toEqual([]);
    expect(
      experimentChangeLabels(
        { ...running, status: "draft" },
        { status: "running", phases: [phase({ coverage: 0.1 })] },
      ),
    ).toEqual(["experiment.start"]);
    expect(experimentChangeLabels(running, { status: "stopped" })).toEqual([
      "experiment.stop",
    ]);
  });
});
