import { ExperimentTargetingData } from "shared/types/experiment";
import { onlyTrafficChanged } from "@/components/Experiment/TabbedPage/targetingDraft";

const stored: ExperimentTargetingData = {
  condition: "",
  coverage: 1,
  namespace: { enabled: false, name: "", range: [0, 1] },
  seed: "seed",
  variationWeights: [0.5, 0.5],
  variations: [
    { id: "v0", status: "active" },
    { id: "v1", status: "active" },
  ],
  savedGroups: [],
  prerequisites: [],
  hashAttribute: "id",
  fallbackAttribute: "",
  hashVersion: 2,
  disableStickyBucketing: false,
  bucketVersion: 1,
  minBucketVersion: 0,
  trackingKey: "exp",
  newPhase: false,
  reseed: true,
};

describe("onlyTrafficChanged", () => {
  it("is traffic when only coverage, the split or the variations move", () => {
    expect(
      onlyTrafficChanged(
        {
          ...stored,
          coverage: 0.4,
          variationWeights: [0.34, 0.33, 0.33],
          variations: [...stored.variations, { id: "v2", status: "active" }],
        },
        stored,
      ),
    ).toBe(true);
  });

  it("is targeting once anything else moves too", () => {
    expect(
      onlyTrafficChanged(
        { ...stored, coverage: 0.4, hashAttribute: "device" },
        stored,
      ),
    ).toBe(false);
    expect(
      onlyTrafficChanged({ ...stored, condition: '{"country":"US"}' }, stored),
    ).toBe(false);
  });
});
