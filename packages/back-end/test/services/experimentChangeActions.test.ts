import type { ExperimentInterface, ExperimentPhase } from "shared/validators";
import { experimentChangeActions } from "back-end/src/services/confirmations";

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

describe("experimentChangeActions", () => {
  it("names Make Changes edits to the live phase", () => {
    expect(
      experimentChangeActions(running, {
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
    const labels = (changes: Partial<ExperimentInterface>) =>
      experimentChangeActions(running, changes);
    expect(labels({ bucketVersion: 2 })).toEqual(["experiment.phases"]);
    expect(
      labels({ phases: [phase({ name: "First" }), phase(), phase()] }),
    ).toEqual(["experiment.phases"]);
    expect(
      labels({
        phases: [
          phase({ name: "First", dateStarted: new Date("2025-12-01") }),
          phase(),
        ],
      }),
    ).toEqual(["experiment.phases"]);
  });

  it("names a field a replacement phase drops", () => {
    expect(
      experimentChangeActions(
        {
          ...running,
          phases: [phase({ name: "First" }), phase({ seed: "s" })],
        },
        { phases: [phase({ name: "First" }), phase()] },
      ),
    ).toEqual(["experiment.phases"]);
  });

  it("names any other change to what a live experiment serves", () => {
    expect(experimentChangeActions(running, { archived: true })).toEqual([
      "experiment.other",
    ]);
    expect(
      experimentChangeActions(running, { trackingKey: "new-key" }),
    ).toEqual(["experiment.other"]);
    expect(
      experimentChangeActions(
        { ...running, status: "draft" },
        { archived: true },
      ),
    ).toEqual([]);
  });

  it("ignores echoed fields, and counts only status on a draft", () => {
    expect(
      experimentChangeActions(running, {
        phases: [phase({ name: "First", savedGroups: [] }), phase()],
      }),
    ).toEqual([]);
    expect(
      experimentChangeActions(
        { ...running, status: "draft" },
        { status: "running", phases: [phase({ coverage: 0.1 })] },
      ),
    ).toEqual(["experiment.start"]);
    expect(experimentChangeActions(running, { status: "stopped" })).toEqual([
      "experiment.stop",
    ]);
  });
});
