import {
  contextualBanditSnapshotSettingsValidator,
  ContextualBanditSnapshotSettings,
} from "../src/validators/contextual-bandit-snapshot";

function buildSettings(
  overrides: Partial<ContextualBanditSnapshotSettings> = {},
): ContextualBanditSnapshotSettings {
  return {
    experimentId: "exp_1",
    trackingKey: "exp_1",
    contextualBanditId: "cb_1",
    phase: 0,

    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    contextualAttributes: ["country", "device"],

    goalMetrics: ["met_g1"],
    secondaryMetrics: [],
    metricSettings: {},

    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],

    maxContexts: 16,
    treeModel: "regression_tree",
    minUsersPerLeaf: 100,
    maxLeaves: 8,
    canonicalFormVersion: 1,

    startDate: new Date("2025-01-01T00:00:00Z"),
    endDate: null,
    reweight: true,
    banditWeightsSeed: 0,
    regressionAdjustmentEnabled: false,

    ...overrides,
  };
}

describe("contextualBanditSnapshotSettingsValidator", () => {
  it("round-trips a complete, well-formed settings object", () => {
    const original = buildSettings({
      secondaryMetrics: ["met_s1"],
      metricSettings: {
        met_g1: { id: "met_g1", windowType: "conversion" },
      },
      endDate: new Date("2025-02-01T00:00:00Z"),
    });

    const parsed = contextualBanditSnapshotSettingsValidator.parse(original);

    expect(parsed).toEqual(original);
    // Round-trip identity for nested arrays/records as well.
    expect(parsed.variations).toEqual(original.variations);
    expect(parsed.metricSettings).toEqual(original.metricSettings);
    expect(parsed.contextualAttributes).toEqual(original.contextualAttributes);
  });

  it("accepts both supported tree models", () => {
    expect(() =>
      contextualBanditSnapshotSettingsValidator.parse(
        buildSettings({ treeModel: "regression_tree" }),
      ),
    ).not.toThrow();
    expect(() =>
      contextualBanditSnapshotSettingsValidator.parse(
        buildSettings({ treeModel: "linear_thompson" }),
      ),
    ).not.toThrow();
  });

  it("rejects a foreign tree model name", () => {
    const result = contextualBanditSnapshotSettingsValidator.safeParse(
      buildSettings({
        // @ts-expect-error -- intentional invalid enum value
        treeModel: "linear_tree",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects `guardrailMetrics` (strict mode forbids unknown keys)", () => {
    // This is the core invariant: even if an experiment doc carries
    // guardrailMetrics, the CB snapshot settings must NEVER allow them in.
    const bogus = {
      ...buildSettings(),
      guardrailMetrics: ["met_guard"],
    };
    const result = contextualBanditSnapshotSettingsValidator.safeParse(bogus);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Strict-mode rejection surfaces as an `unrecognized_keys` issue. The
      // exact path depends on the zod version (in v4 the path is empty + the
      // offending keys live on the issue itself; in older versions the path
      // includes the key). Accept either by searching the serialized issue.
      const serialized = JSON.stringify(result.error.issues);
      expect(serialized).toMatch(/guardrailMetrics/);
    }
  });

  it("rejects other unknown top-level keys (strict mode)", () => {
    const bogus = {
      ...buildSettings(),
      activationMetric: "met_x",
    };
    const result = contextualBanditSnapshotSettingsValidator.safeParse(bogus);
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const partial = buildSettings();
    // Drop the required `treeModel` field.
    delete (partial as Partial<ContextualBanditSnapshotSettings>).treeModel;
    const result = contextualBanditSnapshotSettingsValidator.safeParse(partial);
    expect(result.success).toBe(false);
  });

  it("rejects non-positive maxContexts / minUsersPerLeaf / maxLeaves", () => {
    expect(
      contextualBanditSnapshotSettingsValidator.safeParse(
        buildSettings({ maxContexts: 0 }),
      ).success,
    ).toBe(false);
    expect(
      contextualBanditSnapshotSettingsValidator.safeParse(
        buildSettings({ minUsersPerLeaf: -1 }),
      ).success,
    ).toBe(false);
    expect(
      contextualBanditSnapshotSettingsValidator.safeParse(
        buildSettings({ maxLeaves: 0 }),
      ).success,
    ).toBe(false);
  });

  it("accepts a null endDate (open-ended phase)", () => {
    expect(() =>
      contextualBanditSnapshotSettingsValidator.parse(
        buildSettings({ endDate: null }),
      ),
    ).not.toThrow();
  });
});
