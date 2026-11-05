import type { ExperimentInterface } from "shared/types/experiment";
import type { FeatureInterface } from "shared/types/feature";
import type { ReqContext } from "back-end/types/request";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  assertLivePayloadChangeAllowed,
  getLivePayloadChanges,
} from "back-end/src/services/experimentLivePayload";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesByIds: jest.fn(),
}));

// Which experiment edits would change what a running experiment serves.
describe("getLivePayloadChanges", () => {
  const experiment = {
    type: "standard",
    variations: [
      { id: "v0", key: "0" },
      { id: "v1", key: "1" },
    ],
    phases: [
      {
        coverage: 1,
        variationWeights: [0.5, 0.5],
        variations: [{ id: "v0" }, { id: "v1" }],
      },
    ],
  } as unknown as ExperimentInterface;
  const same = [
    { id: "v0", key: "0" },
    { id: "v1", key: "1" },
  ];

  it.each([
    ["nothing", {}, []],
    ["unchanged variations", { variations: same }, []],
    [
      "a new variation id",
      { variations: [same[0], { id: "v2", key: "1" }] },
      ["variation IDs", "variation keys"],
    ],
    [
      "a variation key",
      { variations: [same[0], { id: "v1", key: "b" }] },
      ["variation keys"],
    ],
    ["coverage", { coverage: 0.5 }, ["coverage"]],
    ["weights", { variationWeights: [0.2, 0.8] }, ["variationWeights"]],
  ])("reports %s", (_label, input, changedFields) => {
    const res = getLivePayloadChanges(experiment, input);
    expect(res.changedFields).toEqual(changedFields);
    expect(res.changesLivePayload).toBe(changedFields.length > 0);
  });

  it("reads variation ids from the experiment when the phase has no envelope", () => {
    const legacy = {
      ...experiment,
      phases: [{ coverage: 1, variationWeights: [0.5, 0.5] }],
    } as unknown as ExperimentInterface;
    expect(
      getLivePayloadChanges(legacy, { variations: same }).changesLivePayload,
    ).toBe(false);
  });

  it("lets the results page reconcile keys without counting as a live change", () => {
    const res = getLivePayloadChanges(experiment, {
      variations: [same[0], { id: "v1", key: "b" }],
      isVariationKeyReconciliation: true,
    });
    expect(res.changedFields).toEqual(["variation keys"]);
    expect(res.changesLivePayload).toBe(false);
  });
});

describe("assertLivePayloadChangeAllowed", () => {
  const context = {} as ReqContext;
  const experiment = (status: string) =>
    ({
      id: "exp_1",
      type: "standard",
      status,
      archived: false,
      linkedFeatures: ["feat_1"],
      variations: [{ id: "v0", key: "0" }],
      phases: [
        { coverage: 1, variationWeights: [1], variations: [{ id: "v0" }] },
      ],
    }) as unknown as ExperimentInterface;
  const feature = (enabled: boolean) =>
    ({
      id: "feat_1",
      archived: false,
      rules: [
        {
          type: "experiment-ref",
          experimentId: "exp_1",
          enabled,
          allEnvironments: true,
        },
      ],
      environmentSettings: { production: { enabled: true, rules: [] } },
    }) as unknown as FeatureInterface;

  beforeEach(() => {
    jest.mocked(getFeaturesByIds).mockReset();
    jest.mocked(getFeaturesByIds).mockResolvedValue([feature(true)]);
  });

  it("refuses a live change only for a running experiment served by a live rule", async () => {
    await expect(
      assertLivePayloadChangeAllowed(context, experiment("running"), {
        coverage: 0.5,
      }),
    ).rejects.toThrow(
      "Cannot change: [coverage] while the experiment is running",
    );

    jest.mocked(getFeaturesByIds).mockResolvedValue([feature(false)]);
    await expect(
      assertLivePayloadChangeAllowed(context, experiment("running"), {
        coverage: 0.5,
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertLivePayloadChangeAllowed(context, experiment("draft"), {
        coverage: 0.5,
      }),
    ).resolves.toBeUndefined();
  });

  it("does not load features when nothing live changes", async () => {
    await expect(
      assertLivePayloadChangeAllowed(context, experiment("running"), {
        coverage: 1,
      }),
    ).resolves.toBeUndefined();
    expect(getFeaturesByIds).not.toHaveBeenCalled();
  });
});
