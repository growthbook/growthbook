import {
  copyManagedVariationValues,
  isManagedByExperiment,
  isManagedFeature,
  managedExperimentFlagsDefault,
  managedFeatureKeyCandidate,
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

describe("managedExperimentFlagsDefault", () => {
  it("is off when neither org nor Project says anything", () => {
    expect(managedExperimentFlagsDefault({ settings: {}, project: null })).toBe(
      false,
    );
    expect(managedExperimentFlagsDefault({})).toBe(false);
  });

  it("follows the org setting when the Project is silent", () => {
    expect(
      managedExperimentFlagsDefault({
        settings: { managedExperimentFlags: true },
        project: { settings: {} },
      }),
    ).toBe(true);
  });

  it("lets the Project override the org in both directions", () => {
    expect(
      managedExperimentFlagsDefault({
        settings: { managedExperimentFlags: true },
        project: { settings: { managedExperimentFlags: false } },
      }),
    ).toBe(false);
    expect(
      managedExperimentFlagsDefault({
        settings: { managedExperimentFlags: false },
        project: { settings: { managedExperimentFlags: true } },
      }),
    ).toBe(true);
  });

  it("treats an absent Project setting as deferral, not as false", () => {
    // The distinction that matters: `undefined` defers to the org, whereas an
    // explicit `false` overrides it.
    expect(
      managedExperimentFlagsDefault({
        settings: { managedExperimentFlags: true },
        project: { settings: { managedExperimentFlags: undefined } },
      }),
    ).toBe(true);
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
