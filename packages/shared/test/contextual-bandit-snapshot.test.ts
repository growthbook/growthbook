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

    datasourceId: "ds_1",
    contextualBanditQueryId: "cbq_1",
    query: "SELECT user_id, timestamp, experiment_id, variation_id FROM t",
    userIdType: "user_id",
    contextualAttributes: ["country", "device"],

    decisionMetric: "met_g1",
    metricSettings: {},

    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],

    minUsersPerLeaf: 100,
    maxLeaves: 8,
    banditModelVersion: 1,

    startDate: new Date("2025-01-01T00:00:00Z"),
    endDate: null,
    reweight: true,
    banditWeightsSeed: 0,

    ...overrides,
  };
}

describe("contextualBanditSnapshotSettingsValidator", () => {
  it("round-trips a complete, well-formed settings object", () => {
    const original = buildSettings({
      metricSettings: {
        met_g1: { id: "met_g1", windowType: "conversion" },
      },
      endDate: new Date("2025-02-01T00:00:00Z"),
    });

    const parsed = contextualBanditSnapshotSettingsValidator.parse(original);

    expect(parsed).toEqual(original);
    expect(parsed.variations).toEqual(original.variations);
    expect(parsed.metricSettings).toEqual(original.metricSettings);
    expect(parsed.contextualAttributes).toEqual(original.contextualAttributes);
  });

  it("rejects `guardrailMetrics` (strict mode forbids unknown keys)", () => {
    const bogus = {
      ...buildSettings(),
      guardrailMetrics: ["met_guard"],
    };
    const result = contextualBanditSnapshotSettingsValidator.safeParse(bogus);
    expect(result.success).toBe(false);
    if (!result.success) {
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
    delete (partial as Partial<ContextualBanditSnapshotSettings>)
      .minUsersPerLeaf;
    const result = contextualBanditSnapshotSettingsValidator.safeParse(partial);
    expect(result.success).toBe(false);
  });

  it("rejects non-positive minUsersPerLeaf / maxLeaves", () => {
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
