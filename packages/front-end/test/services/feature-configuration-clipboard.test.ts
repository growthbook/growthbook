import { FeatureInterface, FeatureRule } from "shared/types/feature";
import {
  applyFeatureReferenceMappings,
  buildFeatureConfigurationClipboardPayload,
  EMPTY_FEATURE_REFERENCE_MAPPINGS,
  extractFeatureReferenceIds,
  parseFeatureConfigurationClipboardPayload,
} from "@/services/feature-configuration-clipboard";

const feature: FeatureInterface = {
  id: "new-homepage",
  organization: "org_123",
  owner: "user_123",
  dateCreated: new Date("2026-01-01T00:00:00.000Z"),
  dateUpdated: new Date("2026-01-02T00:00:00.000Z"),
  valueType: "boolean",
  defaultValue: "false",
  version: 3,
  description: "Controls the new homepage",
  project: "web",
  tags: ["growth"],
  environmentSettings: {
    dev: { enabled: true },
    production: { enabled: false },
  },
  rules: [
    {
      id: "fr_homepage",
      type: "force",
      description: "Enable for beta users",
      condition: '{"id":{"$in":["beta-user"]}}',
      allEnvironments: true,
      value: "true",
    },
  ],
  customFields: {
    team: "growth",
  },
  archived: false,
};

describe("feature configuration clipboard payloads", () => {
  it("builds and parses a GrowthBook feature clipboard envelope", () => {
    const payload = parseFeatureConfigurationClipboardPayload(
      buildFeatureConfigurationClipboardPayload(feature),
    );

    expect(payload).not.toBeNull();
    expect(payload?.growthbook).toMatchObject({
      source: "growthbook",
      object: "feature",
      version: 1,
    });
    expect(payload?.feature).toMatchObject({
      id: "new-homepage",
      valueType: "boolean",
      defaultValue: "false",
      rules: feature.rules,
    });
  });

  it("roundtrips experiment rule bandit start dates as Date instances", () => {
    const banditDate = new Date("2026-02-15T10:30:00.000Z");
    const banditFeature: FeatureInterface = {
      ...feature,
      rules: [
        {
          id: "fr_bandit",
          type: "experiment",
          description: "",
          allEnvironments: true,
          trackingKey: "tk",
          hashAttribute: "id",
          values: [{ value: "a", weight: 0.5 }],
          banditStage: "explore",
          banditStageDateStarted: banditDate,
        },
      ],
    };

    const payload = parseFeatureConfigurationClipboardPayload(
      buildFeatureConfigurationClipboardPayload(banditFeature),
    );

    expect(payload).not.toBeNull();
    const rule = payload?.feature.rules[0];
    expect(rule?.type).toBe("experiment");
    if (rule?.type !== "experiment") return;
    expect(rule.banditStageDateStarted).toBeInstanceOf(Date);
    expect(rule.banditStageDateStarted?.toISOString()).toBe(
      banditDate.toISOString(),
    );
  });

  it("accepts rules carrying stale fields from a prior rule type", () => {
    // Real-world feature rules carry leftover fields when the user switches
    // rule type in the UI — e.g., a rule that was a `rollout` (with
    // `coverage`) and was changed to `force` may still persist `coverage` on
    // disk. The clipboard schema must tolerate these so paste doesn't
    // silently drop the entire payload.
    const featureWithStaleField: FeatureInterface = {
      ...feature,
      rules: [
        {
          id: "fr_force_stale",
          type: "force",
          description: "",
          allEnvironments: false,
          environments: ["dev"],
          value: "false",
          // `coverage` is a `rollout`-rule field; forceRule schema is strict
          // and would reject it without the clipboard validator's leniency.
          coverage: 1,
        } as unknown as FeatureRule,
      ],
    };

    const payload = parseFeatureConfigurationClipboardPayload(
      buildFeatureConfigurationClipboardPayload(featureWithStaleField),
    );

    expect(payload).not.toBeNull();
    expect(payload?.feature.rules).toHaveLength(1);
    expect(payload?.feature.rules[0]?.type).toBe("force");
    expect(payload?.references.environments.map((r) => r.id)).toContain("dev");
  });

  it("ignores non-JSON clipboard text", () => {
    expect(parseFeatureConfigurationClipboardPayload("not json")).toBeNull();
  });

  it("rejects JSON without the GrowthBook feature envelope", () => {
    expect(
      parseFeatureConfigurationClipboardPayload(
        JSON.stringify({ feature: { id: "missing-metadata" } }),
      ),
    ).toBeNull();
  });

  it("throws when a safe-rollout rule references a safeRolloutId missing from the lookup", () => {
    // Building a clipboard envelope with safe-rollout rules but without the
    // matching SafeRollout settings would produce a payload the destination
    // import-draft endpoint can't satisfy. Failing the copy up front (with
    // a descriptive error) is the only signal the user gets before the
    // missing settings cause a partial import + cleanup downstream.
    const featureWithSafeRollout: FeatureInterface = {
      ...feature,
      rules: [
        {
          id: "fr_sr",
          type: "safe-rollout",
          description: "",
          allEnvironments: true,
          safeRolloutId: "sr_missing",
          controlValue: "false",
          variationValue: "true",
          status: "running",
          hashAttribute: "id",
          seed: "x",
          trackingKey: "tk",
        },
      ],
    };

    expect(() =>
      buildFeatureConfigurationClipboardPayload(featureWithSafeRollout, {
        // Empty safeRollouts lookup — sr_missing isn't there.
        safeRollouts: new Map(),
      }),
    ).toThrow(/sr_missing/);
  });
});

describe("feature reference extraction and mapping", () => {
  const rules: FeatureRule[] = [
    {
      id: "fr_ref",
      type: "experiment-ref",
      description: "",
      allEnvironments: true,
      experimentId: "exp_abc",
      variations: [{ variationId: "v0", value: "true" }],
      prerequisites: [{ id: "feat_prereq", condition: "" }],
    },
    {
      id: "fr_sr",
      type: "safe-rollout",
      description: "",
      allEnvironments: true,
      safeRolloutId: "sr_old",
      controlValue: "a",
      variationValue: "b",
      status: "running",
      hashAttribute: "id",
      seed: "x",
      trackingKey: "tk",
    },
    {
      id: "fr_force",
      type: "force",
      description: "",
      allEnvironments: false,
      environments: ["dev", "staging"],
      value: "true",
      condition: JSON.stringify({
        $or: [{ id: { $inGroup: "grp_a" } }, { id: { $notInGroup: "grp_b" } }],
      }),
      savedGroups: [{ match: "all", ids: ["grp_a", "grp_c"] }],
    },
  ];

  const clipboardFeature = {
    id: "f",
    valueType: "boolean" as const,
    defaultValue: "false",
    rules,
  };

  it("extracts every cross-org reference id by category", () => {
    const ids = extractFeatureReferenceIds(clipboardFeature);
    expect(Array.from(ids.experiments)).toEqual(["exp_abc"]);
    expect(Array.from(ids.safeRollouts)).toEqual(["sr_old"]);
    expect(Array.from(ids.savedGroups).sort()).toEqual([
      "grp_a",
      "grp_b",
      "grp_c",
    ]);
    expect(Array.from(ids.features)).toEqual(["feat_prereq"]);
    expect(Array.from(ids.environments).sort()).toEqual(["dev", "staging"]);
  });

  it("rewrites referenced ids in rules, conditions, prereqs, and envs", () => {
    const mapped = applyFeatureReferenceMappings(clipboardFeature, {
      ...EMPTY_FEATURE_REFERENCE_MAPPINGS,
      experiments: { exp_abc: "exp_new" },
      safeRollouts: { sr_old: "sr_new" },
      savedGroups: { grp_a: "grp_A2", grp_b: "grp_B2" },
      features: { feat_prereq: "feat_new" },
      environments: { dev: "development", staging: "production" },
    });

    const expRef = mapped.rules.find((r) => r.type === "experiment-ref");
    expect(
      expRef && "experimentId" in expRef ? expRef.experimentId : null,
    ).toBe("exp_new");
    expect(expRef?.prerequisites?.[0].id).toBe("feat_new");

    // safe-rollout safeRolloutId is intentionally NOT remapped on the
    // frontend; the backend mints a fresh SafeRollout during import and
    // rewrites the id server-side. The source id should pass through here.
    const sr = mapped.rules.find((r) => r.type === "safe-rollout");
    expect(sr && "safeRolloutId" in sr ? sr.safeRolloutId : null).toBe(
      "sr_old",
    );

    const force = mapped.rules.find((r) => r.type === "force");
    expect(force?.savedGroups?.[0].ids).toEqual(["grp_A2", "grp_c"]);
    expect(force?.environments).toEqual(["development", "production"]);
    const parsedCondition = JSON.parse(force?.condition ?? "{}");
    expect(parsedCondition.$or[0].id.$inGroup).toBe("grp_A2");
    expect(parsedCondition.$or[1].id.$notInGroup).toBe("grp_B2");
  });

  it("does not collect environmentSettings keys as references", () => {
    // A feature with only allEnvironments-true rules has no cross-org env
    // refs — env-scoped rule fields are the only source of environment
    // references in the clipboard manifest.
    const ids = extractFeatureReferenceIds({
      id: "f",
      valueType: "boolean",
      defaultValue: "false",
      rules: [
        {
          id: "fr_force",
          type: "force",
          description: "",
          allEnvironments: true,
          value: "true",
        },
      ],
    });
    expect(Array.from(ids.environments)).toEqual([]);
  });
});
