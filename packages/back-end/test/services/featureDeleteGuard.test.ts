import type { FeatureInterface } from "shared/types/feature";
import { assertFeatureDeletable } from "back-end/src/services/features";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getAllExperimentsForStaleGraph } from "back-end/src/models/ExperimentModel";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesWithoutEditorFields: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllExperimentsForStaleGraph: jest.fn(),
}));

// Deleting a flag that something still gates on as a prerequisite would leave
// that dependent pointing at nothing, and the payload builder then drops it
// silently. Live features and unarchived experiments both block the delete.
describe("assertFeatureDeletable", () => {
  const org = { id: "org", settings: { environments: [{ id: "production" }] } };
  const context = {
    org,
    scanContextOverride: { org },
  } as unknown as ReqContext;
  const PARENT = "parent_flag";
  const gate = { id: PARENT, condition: '{"value": true}' };
  const feature = (id: string, prerequisites: (typeof gate)[] = []) =>
    ({
      id,
      archived: false,
      environmentSettings: { production: { enabled: true } },
      rules: [],
      prerequisites,
    }) as unknown as FeatureInterface;
  const experiment = (id: string, prerequisites: (typeof gate)[] = []) => ({
    id,
    status: "running",
    phases: [{ prerequisites }],
  });

  const stub = (
    features: FeatureInterface[],
    experiments: ReturnType<typeof experiment>[],
  ) => {
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue(features);
    jest
      .mocked(getAllExperimentsForStaleGraph)
      .mockResolvedValue(experiments as never);
  };

  it("is blocked by a live feature prerequisite", async () => {
    stub([feature("child", [gate])], []);
    await expect(assertFeatureDeletable(context, PARENT)).rejects.toThrow(
      /1 live Feature Flag\(s\)\. Remove/,
    );
  });

  it("is blocked by an experiment phase prerequisite", async () => {
    stub([], [experiment("exp", [gate])]);
    await expect(assertFeatureDeletable(context, PARENT)).rejects.toThrow(
      /1 Experiment\(s\)\. Remove/,
    );
  });

  it("names both kinds when both depend on it", async () => {
    stub([feature("child", [gate])], [experiment("exp", [gate])]);
    await expect(assertFeatureDeletable(context, PARENT)).rejects.toThrow(
      /1 live Feature Flag\(s\) and 1 Experiment\(s\)/,
    );
  });

  it("only the latest experiment phase counts", async () => {
    stub(
      [],
      [
        {
          ...experiment("exp"),
          phases: [{ prerequisites: [gate] }, { prerequisites: [] }],
        },
      ],
    );
    await expect(
      assertFeatureDeletable(context, PARENT),
    ).resolves.toBeUndefined();
  });

  it("proceeds once nothing depends on it", async () => {
    stub([feature("unrelated")], [experiment("exp")]);
    await expect(
      assertFeatureDeletable(context, PARENT),
    ).resolves.toBeUndefined();
  });
});
