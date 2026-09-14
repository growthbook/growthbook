import type { ExperimentInterface } from "shared/types/experiment";
import { getLivePayloadChanges } from "back-end/src/services/experimentLivePayload";

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

  it("lets the results page reconcile keys without counting as a live change", () => {
    const res = getLivePayloadChanges(experiment, {
      variations: [same[0], { id: "v1", key: "b" }],
      isVariationKeyReconciliation: true,
    });
    expect(res.changedFields).toEqual(["variation keys"]);
    expect(res.changesLivePayload).toBe(false);
  });
});
