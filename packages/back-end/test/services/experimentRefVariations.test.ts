import { ExperimentInterface } from "shared/validators";
import {
  assertExperimentRefVariationsMatchExperiment,
  assertVariationsCoverArms,
} from "back-end/src/services/experiment-feature";

type TestExperiment = Pick<ExperimentInterface, "id" | "variations" | "phases">;

const experiment = ({
  variationIds,
  phaseVariations,
}: {
  variationIds: string[];
  phaseVariations?: { id: string; status: "active" }[];
}): TestExperiment =>
  ({
    id: "exp_1",
    variations: variationIds.map((id, i) => ({
      id,
      key: `${i}`,
      name: `Variation ${i}`,
      description: "",
      screenshots: [],
    })),
    phases: [
      {
        variations:
          phaseVariations ??
          variationIds.map((id) => ({ id, status: "active" as const })),
      },
    ],
  }) as unknown as TestExperiment;

const variations = (ids: string[]) =>
  ids.map((variationId) => ({ variationId }));

describe("assertExperimentRefVariationsMatchExperiment", () => {
  it("accepts one entry per variation", () => {
    expect(() =>
      assertExperimentRefVariationsMatchExperiment({
        variations: variations(["v0", "v1"]),
        experiment: experiment({ variationIds: ["v0", "v1"] }),
      }),
    ).not.toThrow();
  });

  it("accepts the variations in any order", () => {
    expect(() =>
      assertExperimentRefVariationsMatchExperiment({
        variations: variations(["v1", "v0"]),
        experiment: experiment({ variationIds: ["v0", "v1"] }),
      }),
    ).not.toThrow();
  });

  it("rejects too few variations", () => {
    expect(() =>
      assertExperimentRefVariationsMatchExperiment({
        variations: variations(["v0"]),
        experiment: experiment({ variationIds: ["v0", "v1", "v2"] }),
      }),
    ).toThrow(
      'Expected 3 variation(s) for experiment "exp_1" but 1 were specified. Provide exactly one value per variation.',
    );
  });

  it("rejects too many variations", () => {
    expect(() =>
      assertExperimentRefVariationsMatchExperiment({
        variations: variations(["v0", "v1", "v2"]),
        experiment: experiment({ variationIds: ["v0", "v1"] }),
      }),
    ).toThrow(
      'Expected 2 variation(s) for experiment "exp_1" but 3 were specified',
    );
  });

  it("rejects a variationId that isn't on the experiment", () => {
    expect(() =>
      assertExperimentRefVariationsMatchExperiment({
        variations: variations(["v0", "nope"]),
        experiment: experiment({ variationIds: ["v0", "v1"] }),
      }),
    ).toThrow(
      'variationId "nope" is not a variation of experiment "exp_1". Valid ids: v0, v1',
    );
  });

  it("rejects a duplicated variationId that leaves another arm uncovered", () => {
    expect(() =>
      assertExperimentRefVariationsMatchExperiment({
        variations: variations(["v0", "v0"]),
        experiment: experiment({ variationIds: ["v0", "v1"] }),
      }),
    ).toThrow('variationId "v0" is specified more than once');
  });

  // The phase, not `experiment.variations`, is the source of truth: a variation
  // added to the experiment but absent from the current phase isn't expected.
  it("counts the current phase's variations, not every variation on the experiment", () => {
    const exp = experiment({
      variationIds: ["v0", "v1", "v2"],
      phaseVariations: [
        { id: "v0", status: "active" },
        { id: "v1", status: "active" },
      ],
    });

    expect(() =>
      assertExperimentRefVariationsMatchExperiment({
        variations: variations(["v0", "v1"]),
        experiment: exp,
      }),
    ).not.toThrow();

    expect(() =>
      assertExperimentRefVariationsMatchExperiment({
        variations: variations(["v0", "v1", "v2"]),
        experiment: exp,
      }),
    ).toThrow(
      'Expected 2 variation(s) for experiment "exp_1" but 3 were specified',
    );
  });
});

// The same primitive backs the contextual-bandit path, which has no phases.
describe("assertVariationsCoverArms", () => {
  const call = (ids: string[], armIds: string[]) =>
    assertVariationsCoverArms({
      variations: ids.map((variationId) => ({ variationId })),
      armIds,
      entityLabel: 'Contextual Bandit "cb_1"',
    });

  it("accepts full coverage in any order", () => {
    expect(() => call(["v1", "v0"], ["v0", "v1"])).not.toThrow();
  });

  it("names the entity when an id isn't one of its arms", () => {
    expect(() => call(["v0", "nope"], ["v0", "v1"])).toThrow(
      'variationId "nope" is not a variation of Contextual Bandit "cb_1". Valid ids: v0, v1',
    );
  });

  it("rejects a count mismatch", () => {
    expect(() => call(["v0"], ["v0", "v1"])).toThrow(
      'Expected 2 variation(s) for Contextual Bandit "cb_1" but 1 were specified',
    );
  });
});
