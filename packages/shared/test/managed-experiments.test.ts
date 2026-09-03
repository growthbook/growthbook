import {
  copyManagedVariationValues,
  isManagedByExperiment,
  isManagedFeature,
  managedByExperimentId,
  managedFeatureKeyCandidate,
  requireFreshBaseForPublish,
  seedManagedVariationValues,
} from "../src/util/managed-experiments";

describe("managedFeatureKeyCandidate", () => {
  const experimentId = "exp_abc123";

  it("passes through a key that is already legal", () => {
    expect(
      managedFeatureKeyCandidate({
        trackingKey: "checkout-button-v2",
        experimentId,
      }),
    ).toBe("checkout-button-v2");
  });

  it("keeps every character a feature id permits", () => {
    // The charset is /^[a-zA-Z0-9_.:|-]+$/ — colons and pipes are legal and
    // must survive, or keys silently change shape for existing conventions.
    expect(
      managedFeatureKeyCandidate({
        trackingKey: "team:checkout|v2.1_final-3",
        experimentId,
      }),
    ).toBe("team:checkout|v2.1_final-3");
  });

  it("collapses runs of illegal characters to a single dash", () => {
    expect(
      managedFeatureKeyCandidate({
        trackingKey: "my great   experiment!!",
        experimentId,
      }),
    ).toBe("my-great-experiment");
  });

  it("trims dashes introduced at the edges by sanitizing", () => {
    expect(
      managedFeatureKeyCandidate({ trackingKey: "  !hello!  ", experimentId }),
    ).toBe("hello");
  });

  it("falls back to the experiment id when nothing legal survives", () => {
    expect(
      managedFeatureKeyCandidate({ trackingKey: "!!! ???", experimentId }),
    ).toBe(experimentId);
  });

  it("suffixes by attempt so collisions retry onto a fresh key", () => {
    const base = { trackingKey: "signup-flow", experimentId };
    expect(managedFeatureKeyCandidate({ ...base, attempt: 0 })).toBe(
      "signup-flow",
    );
    // attempt 1 is the SECOND try, so it reads -2 rather than -1.
    expect(managedFeatureKeyCandidate({ ...base, attempt: 1 })).toBe(
      "signup-flow-2",
    );
    expect(managedFeatureKeyCandidate({ ...base, attempt: 4 })).toBe(
      "signup-flow-5",
    );
  });

  it("never emits a candidate outside the feature id charset", () => {
    const messy = "  ✨ Émoji & spaces / slashes ✨  ";
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = managedFeatureKeyCandidate({
        trackingKey: messy,
        experimentId,
        attempt,
      });
      expect(key).toMatch(/^[a-zA-Z0-9_.:|-]+$/);
    }
  });
});

describe("isManagedFeature / isManagedByExperiment", () => {
  const managed = {
    managedBy: { type: "experiment" as const, experimentId: "exp_1" },
  };

  it("recognizes a managed flag", () => {
    expect(isManagedFeature(managed)).toBe(true);
    expect(isManagedFeature({ managedBy: undefined })).toBe(false);
  });

  it("only matches the experiment that actually owns it", () => {
    expect(isManagedByExperiment(managed, "exp_1")).toBe(true);
    // A flag owned by a DIFFERENT experiment must not pass — this is what stops
    // the experiment-scoped routes becoming a lockdown bypass.
    expect(isManagedByExperiment(managed, "exp_2")).toBe(false);
    expect(isManagedByExperiment({ managedBy: undefined }, "exp_1")).toBe(
      false,
    );
  });
});

describe("managedByExperimentId", () => {
  it("returns the owning experiment, or null when nothing owns it", () => {
    expect(
      managedByExperimentId({
        managedBy: { type: "experiment", experimentId: "exp_1" },
      }),
    ).toBe("exp_1");
    expect(managedByExperimentId({ managedBy: undefined })).toBeNull();
  });
});

describe("seedManagedVariationValues", () => {
  it("pairs each variation id with its key", () => {
    expect(
      seedManagedVariationValues([
        { id: "v0", key: "control" },
        { id: "v1", key: "treatment" },
      ]),
    ).toEqual([
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "treatment" },
    ]);
  });

  it("falls back to the index when a variation has no key", () => {
    expect(
      seedManagedVariationValues([{ id: "v0" }, { id: "v1", key: "" }]),
    ).toEqual([
      { variationId: "v0", value: "0" },
      { variationId: "v1", value: "1" },
    ]);
  });

  const threeVariations = [
    { id: "v0", key: "control" },
    { id: "v1", key: "treatment" },
    { id: "v2", key: "treatment-2" },
  ];

  it("seeds booleans with control off and the rest on", () => {
    // A key-truthiness test would make every value true and serve one value to
    // everyone, which is not an experiment.
    expect(
      seedManagedVariationValues(threeVariations, "boolean").map(
        (v) => v.value,
      ),
    ).toEqual(["false", "true", "true"]);
  });

  it("seeds numbers by position", () => {
    expect(
      seedManagedVariationValues(threeVariations, "number").map((v) => v.value),
    ).toEqual(["0", "1", "2"]);
  });

  it("seeds JSON the value field will parse", () => {
    const seeded = seedManagedVariationValues(threeVariations, "json");
    expect(seeded.map((v) => JSON.parse(v.value))).toEqual([
      { value: "control" },
      { value: "treatment" },
      { value: "treatment-2" },
    ]);
  });

  it("keeps the key for the default string type", () => {
    expect(
      seedManagedVariationValues(threeVariations, "string").map((v) => v.value),
    ).toEqual(["control", "treatment", "treatment-2"]);
  });
});

describe("copyManagedVariationValues", () => {
  const sourceVariations = [{ id: "src0" }, { id: "src1" }];
  const sourceValues = [
    { variationId: "src0", value: "old-control" },
    { variationId: "src1", value: "old-treatment" },
  ];

  it("copies by position, since a duplicate gets fresh variation ids", () => {
    expect(
      copyManagedVariationValues({
        sourceValues,
        sourceVariations,
        targetVariations: [
          { id: "new0", key: "control" },
          { id: "new1", key: "treatment" },
        ],
      }),
    ).toEqual([
      { variationId: "new0", value: "old-control" },
      { variationId: "new1", value: "old-treatment" },
    ]);
  });

  it("seeds variations the source does not cover", () => {
    expect(
      copyManagedVariationValues({
        sourceValues,
        sourceVariations,
        targetVariations: [
          { id: "new0", key: "control" },
          { id: "new1", key: "treatment" },
          { id: "new2", key: "third" },
        ],
      })[2],
    ).toEqual({ variationId: "new2", value: "third" });
  });

  it("seeds a position the source left unset rather than dropping it", () => {
    expect(
      copyManagedVariationValues({
        // src1 has no value — the rule never defined one.
        sourceValues: [{ variationId: "src0", value: "old-control" }],
        sourceVariations,
        targetVariations: [
          { id: "new0", key: "control" },
          { id: "new1", key: "treatment" },
        ],
      }),
    ).toEqual([
      { variationId: "new0", value: "old-control" },
      { variationId: "new1", value: "treatment" },
    ]);
  });

  it("ignores source values beyond the target's variation count", () => {
    expect(
      copyManagedVariationValues({
        sourceValues,
        sourceVariations,
        targetVariations: [{ id: "new0", key: "control" }],
      }),
    ).toEqual([{ variationId: "new0", value: "old-control" }]);
  });
});

describe("requireFreshBaseForPublish", () => {
  const managed = {
    managedBy: { type: "experiment" as const, experimentId: "exp_1" },
  };
  const shared = { managedBy: undefined };

  it("always requires a fresh base on a managed flag under approvals", () => {
    expect(
      requireFreshBaseForPublish({
        feature: managed,
        reviewRequired: true,
        orgSetting: false,
      }),
    ).toBe(true);
  });

  it("follows the org setting when approvals do not apply", () => {
    expect(
      requireFreshBaseForPublish({
        feature: managed,
        reviewRequired: false,
        orgSetting: false,
      }),
    ).toBe(false);
    expect(
      requireFreshBaseForPublish({
        feature: managed,
        reviewRequired: false,
        orgSetting: true,
      }),
    ).toBe(true);
  });

  it("leaves shared flags on the org setting", () => {
    expect(
      requireFreshBaseForPublish({
        feature: shared,
        reviewRequired: true,
        orgSetting: false,
      }),
    ).toBe(false);
  });
});
