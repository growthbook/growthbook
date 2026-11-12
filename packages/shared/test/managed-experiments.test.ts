import {
  copyManagedVariationValues,
  featureKeyFormatError,
  getManagedValueProblems,
  hasStartReadyManagedFlag,
  isManagedByExperiment,
  isManagedFeature,
  managedByExperimentId,
  managedFeatureKeyCandidate,
  requireFreshBaseForPublish,
  seedManagedVariationValues,
} from "../src/util/managed-experiments";

describe("featureKeyFormatError", () => {
  it("passes any well-formed key when the org sets no format", () => {
    expect(featureKeyFormatError("any.key:v2|ok_-", undefined)).toBeNull();
  });

  it("refuses characters no Feature Flag key may hold, whatever the format", () => {
    expect(featureKeyFormatError("anything goes", undefined)).toBe(
      "Feature Flag keys can only include letters, numbers, and the characters _-.:|",
    );
    expect(featureKeyFormatError("team_ bad", "^team_")).toMatch(
      /can only include/,
    );
  });

  it("names the format a key fails, and passes one that matches", () => {
    expect(featureKeyFormatError("checkout-v2", "^team_")).toBe(
      "Your organization requires Feature Flag keys to match ^team_",
    );
    expect(featureKeyFormatError("team_checkout", "^team_")).toBeNull();
  });
});

describe("managedFeatureKeyCandidate", () => {
  const experimentId = "exp_abc123";

  it.each([
    {
      trackingKey: "team:checkout|v2.1_final-3",
      expected: "team:checkout|v2.1_final-3",
    },
    { trackingKey: "my great   experiment!!", expected: "my-great-experiment" },
    { trackingKey: "  !hello!  ", expected: "hello" },
    {
      trackingKey: "  ✨ Émoji & spaces / slashes ✨  ",
      expected: "moji-spaces-slashes",
    },
    // Nothing legal survives.
    { trackingKey: "!!! ???", expected: experimentId },
  ])("sanitizes $trackingKey to $expected", ({ trackingKey, expected }) => {
    expect(managedFeatureKeyCandidate({ trackingKey, experimentId })).toBe(
      expected,
    );
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
});

describe("managedByExperimentId / isManagedFeature / isManagedByExperiment", () => {
  const managed = {
    managedBy: { type: "experiment" as const, experimentId: "exp_1" },
  };

  it("returns the owning experiment, or null when nothing owns it", () => {
    expect(managedByExperimentId(managed)).toBe("exp_1");
    expect(isManagedFeature(managed)).toBe(true);
    expect(managedByExperimentId({ managedBy: undefined })).toBeNull();
    expect(isManagedFeature({ managedBy: undefined })).toBe(false);
  });

  it("only matches the experiment that actually owns it", () => {
    expect(isManagedByExperiment(managed, "exp_1")).toBe(true);
    // Otherwise experiment-scoped routes would bypass the managed-flag lockdown.
    expect(isManagedByExperiment(managed, "exp_2")).toBe(false);
    expect(isManagedByExperiment({ managedBy: undefined }, "exp_1")).toBe(
      false,
    );
  });
});

describe("seedManagedVariationValues", () => {
  it("pairs each variation id with its key, or its index without one", () => {
    expect(
      seedManagedVariationValues([
        { id: "v0", key: "control" },
        { id: "v1" },
        { id: "v2", key: "" },
      ]),
    ).toEqual([
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "1" },
      { variationId: "v2", value: "2" },
    ]);
  });

  const threeVariations = [
    { id: "v0", key: "control" },
    { id: "v1", key: "treatment" },
    { id: "v2", key: "treatment-2" },
  ];

  it.each([
    ["boolean", ["false", "true", "true"]],
    ["number", ["0", "1", "2"]],
  ] as const)("seeds %s by position", (valueType, expected) => {
    expect(
      seedManagedVariationValues(threeVariations, valueType).map(
        (v) => v.value,
      ),
    ).toEqual(expected);
  });

  it("seeds JSON the value field will parse", () => {
    const seeded = seedManagedVariationValues(threeVariations, "json");
    expect(seeded.map((v) => JSON.parse(v.value))).toEqual([
      { value: "control" },
      { value: "treatment" },
      { value: "treatment-2" },
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

  it("seeds positions the source has no value for or does not reach", () => {
    expect(
      copyManagedVariationValues({
        sourceValues: [{ variationId: "src0", value: "old-control" }],
        sourceVariations,
        targetVariations: [
          { id: "new0", key: "control" },
          { id: "new1", key: "treatment" },
          { id: "new2", key: "third" },
        ],
      }),
    ).toEqual([
      { variationId: "new0", value: "old-control" },
      { variationId: "new1", value: "treatment" },
      { variationId: "new2", value: "third" },
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
  const managedFlag = {
    managedBy: { type: "experiment" as const, experimentId: "exp_1" },
  };

  // A managed flag under approvals always needs one; otherwise the org decides.
  it.each([
    [true, true, false, true],
    [true, false, false, false],
    [true, false, true, true],
    [false, true, false, false],
  ])(
    "managed %s, review %s, org %s -> %s",
    (managed, reviewRequired, orgSetting, expected) => {
      expect(
        requireFreshBaseForPublish({
          feature: managed ? managedFlag : { managedBy: undefined },
          reviewRequired,
          orgSetting,
        }),
      ).toBe(expected);
    },
  );
});

describe("hasStartReadyManagedFlag", () => {
  const managed = {
    feature: {
      managedBy: { type: "experiment" as const, experimentId: "exp_1" },
    },
  };
  const shared = { feature: { managedBy: undefined } };

  it.each([
    ["live", true],
    ["draft", true],
    ["discarded", false],
    ["archived", false],
  ] as const)("%s managed flag -> %s", (state, expected) => {
    expect(hasStartReadyManagedFlag("exp_1", [{ ...managed, state }])).toBe(
      expected,
    );
  });

  it("ignores flags managed by another experiment and shared flags", () => {
    expect(
      hasStartReadyManagedFlag("exp_2", [{ ...managed, state: "live" }]),
    ).toBe(false);
    expect(
      hasStartReadyManagedFlag("exp_1", [{ ...shared, state: "live" }]),
    ).toBe(false);
    expect(hasStartReadyManagedFlag("exp_1", [])).toBe(false);
  });
});

describe("getManagedValueProblems", () => {
  const variations = [
    { id: "v0", name: "Control" },
    { id: "v1", name: "Variation 1" },
    { id: "v2", name: "" },
  ];

  it("flags numbers that do not parse, and accepts any string", () => {
    const numberProblems = getManagedValueProblems({
      variations,
      values: [
        { variationId: "v0", value: "abc" },
        { variationId: "v1", value: "" },
        { variationId: "v2", value: "7" },
      ],
      valueType: "number",
    });
    expect(numberProblems.map((p) => [p.variationId, p.problem])).toEqual([
      ["v0", "malformed"],
      ["v1", "malformed"],
    ]);
    expect(
      getManagedValueProblems({
        variations,
        values: [
          { variationId: "v0", value: "" },
          { variationId: "v1", value: "anything" },
          { variationId: "v2", value: "{" },
        ],
        valueType: "string",
      }),
    ).toEqual([]);
  });

  it("names arms with no value, falling back to their index", () => {
    expect(
      getManagedValueProblems({
        variations,
        values: [{ variationId: "v0", value: "a" }],
        valueType: "string",
      }),
    ).toEqual([
      { variationId: "v1", variationName: "Variation 1", problem: "missing" },
      { variationId: "v2", variationName: "Variation 2", problem: "missing" },
    ]);
  });

  it("flags values that do not parse as the draft's type", () => {
    const problems = getManagedValueProblems({
      variations,
      values: [
        { variationId: "v0", value: "{" },
        { variationId: "v1", value: '{"ok": true}' },
        { variationId: "v2", value: "" },
      ],
      valueType: "json",
    });
    expect(problems.map((p) => [p.variationId, p.problem])).toEqual([
      ["v0", "malformed"],
      ["v2", "malformed"],
    ]);
    expect(problems[0].detail).toBeTruthy();
  });

  it("treats anything but true/false as malformed for booleans", () => {
    expect(
      getManagedValueProblems({
        variations: variations.slice(0, 2),
        values: [
          { variationId: "v0", value: "true" },
          { variationId: "v1", value: "yes" },
        ],
        valueType: "boolean",
      }),
    ).toEqual([
      {
        variationId: "v1",
        variationName: "Variation 1",
        problem: "malformed",
        detail: "Must be true or false",
      },
    ]);
  });
});
