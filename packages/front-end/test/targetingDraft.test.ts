import { ExperimentTargetingData } from "shared/types/experiment";
import {
  mergeStagedTargeting,
  onlyTrafficChanged,
} from "@/components/Experiment/TabbedPage/targetingDraft";

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
  });
});

describe("mergeStagedTargeting", () => {
  it("keeps mine, takes theirs elsewhere, and agrees where both match", () => {
    const { merged, contested } = mergeStagedTargeting(
      stored,
      { ...stored, condition: '{"country":"US"}', coverage: 0.5 },
      { ...stored, trackingKey: "renamed", coverage: 0.5 },
    );
    expect(merged).toEqual({
      ...stored,
      condition: '{"country":"US"}',
      trackingKey: "renamed",
      coverage: 0.5,
    });
    expect(contested).toEqual([]);
  });

  it("contests a field both changed differently, keeping mine", () => {
    const { merged, contested } = mergeStagedTargeting(
      stored,
      { ...stored, hashAttribute: "device" },
      { ...stored, hashAttribute: "account" },
    );
    expect(merged.hashAttribute).toBe("device");
    expect(contested).toEqual(["hashAttribute"]);
  });
});
