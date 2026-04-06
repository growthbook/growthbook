/// <reference types="jest" />

import { ExperimentInterface } from "shared/types/experiment";
import { getLatestPhaseVariations } from "../src/experiments/variations";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toEqual: (expected: unknown) => void;
};

type MinimalExperiment = Pick<ExperimentInterface, "variations" | "phases">;

function makeExperiment(
  overrides?: Partial<MinimalExperiment>,
): MinimalExperiment {
  return {
    variations: [
      {
        id: "v0",
        key: "control",
        name: "Control",
        screenshots: [],
      },
      {
        id: "v1",
        key: "treatment",
        name: "Treatment",
        screenshots: [],
      },
    ],
    phases: [
      {
        variations: [
          { id: "v1", status: "active" },
          { id: "v0", status: "active" },
        ],
      },
    ],
    ...overrides,
  } as unknown as MinimalExperiment;
}

describe("getLatestPhaseVariations", () => {
  it("returns latest phase variations with phase statuses when all ids are found", () => {
    const experiment = makeExperiment();

    expect(getLatestPhaseVariations(experiment)).toEqual([
      {
        id: "v1",
        key: "treatment",
        name: "Treatment",
        screenshots: [],
        index: 1,
        status: "active",
      },
      {
        id: "v0",
        key: "control",
        name: "Control",
        screenshots: [],
        index: 0,
        status: "active",
      },
    ]);
  });

  it('falls back to all variations with status "active" if any phase variation id is missing', () => {
    const experiment = makeExperiment({
      phases: [
        {
          variations: [
            { id: "missing-id", status: "active" },
            { id: "v0", status: "active" },
          ],
        },
      ] as unknown as MinimalExperiment["phases"],
    });

    expect(getLatestPhaseVariations(experiment)).toEqual([
      {
        id: "v0",
        key: "control",
        name: "Control",
        screenshots: [],
        index: 0,
        status: "active",
      },
      {
        id: "v1",
        key: "treatment",
        name: "Treatment",
        screenshots: [],
        index: 1,
        status: "active",
      },
    ]);
  });

  // Shouldn't happen given the JIT migration
  it('falls back to all variations with status "active" when latest phase variations are missing', () => {
    const experiment = makeExperiment({
      phases: [{}] as unknown as MinimalExperiment["phases"],
    });

    expect(getLatestPhaseVariations(experiment)).toEqual([
      {
        id: "v0",
        key: "control",
        name: "Control",
        screenshots: [],
        index: 0,
        status: "active",
      },
      {
        id: "v1",
        key: "treatment",
        name: "Treatment",
        screenshots: [],
        index: 1,
        status: "active",
      },
    ]);
  });
});
