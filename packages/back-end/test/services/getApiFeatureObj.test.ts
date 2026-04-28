import { FeatureInterface, LegacyFeatureInterface } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import { ExperimentInterface } from "shared/types/experiment";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { GroupMap } from "shared/types/saved-group";
import { getApiFeatureObj } from "back-end/src/services/features";
import { migrateRawFeatureToV2 } from "back-end/src/models/FeatureModel";
import { ReqContext } from "back-end/types/request";

// Regression: env-less org → v1 REST emit dropped every rule because
// `getApiFeatureObj` used `org.settings.environments ?? []` instead of the
// `getEnvironments` backfill. Reproduces v0 mongo doc → JIT migrate → v1 API.
function failingV0Feature(): LegacyFeatureInterface {
  return {
    id: "feat_test",
    organization: "org_test",
    owner: "tester",
    dateCreated: new Date("2024-01-01"),
    dateUpdated: new Date("2024-01-01"),
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    tags: [],
    project: "",
    rules: [
      {
        id: "fr_real",
        type: "experiment",
        description: "",
        trackingKey: "",
        hashAttribute: "deviceId",
        values: [
          { weight: 0.9, value: "false" },
          { weight: 0.1, value: "true" },
        ],
        condition: '{"country": "US"}',
        enabled: true,
        coverage: 1,
        value: "false",
      } as unknown as Parameters<typeof migrateRawFeatureToV2>[0]["rules"][0],
    ],
  } as LegacyFeatureInterface;
}

describe("getApiFeatureObj: env-less org backfill", () => {
  it("emits the migrated rule in every backfilled env (dev + production)", () => {
    const organization = { id: "org_test" } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const feature: FeatureInterface = migrateRawFeatureToV2(
      failingV0Feature(),
      ctx,
    );
    expect(feature.rules).toHaveLength(1);
    expect(feature.rules[0].allEnvironments).toBe(true);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    expect(Object.keys(api.environments).sort()).toEqual(["dev", "production"]);
    expect(api.environments.dev.rules).toHaveLength(1);
    expect(api.environments.production.rules).toHaveLength(1);
    expect(api.environments.dev.rules[0].id).toBe("fr_real");
    expect(api.environments.production.rules[0].id).toBe("fr_real");
  });
});

// `getApiFeatureObj` (raw spread) and `revisionToApiInterface`
// (`normalizeRuleForApi`) intentionally diverge on per-rule shape — the
// former keeps `values`/raw `namespace`, the latter renames to `value` and
// runs `toApiNamespace`.
describe("getApiFeatureObj: per-env rule shape parity (vs origin/main)", () => {
  it("preserves experiment rule `values` and `namespace` fields verbatim", () => {
    const organization = {
      id: "org_test",
      settings: { environments: [{ id: "preprod" }] },
    } as unknown as OrganizationInterface;

    const feature: FeatureInterface = {
      id: "feat_exp",
      organization: "org_test",
      owner: "tester",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "string",
      defaultValue: "a",
      version: 1,
      tags: [],
      project: "",
      environmentSettings: { preprod: { enabled: true } },
      rules: [
        {
          id: "rule_exp",
          type: "experiment",
          description: "",
          trackingKey: "tk",
          hashAttribute: "id",
          values: [
            { weight: 0.34, value: "a" },
            { weight: 0.33, value: "b" },
            { weight: 0.33, value: "c" },
          ],
          coverage: 1,
          condition: "{}",
          enabled: true,
          namespace: { enabled: false, name: "", range: [0, 0.5] },
          allEnvironments: true,
        },
      ],
    } as unknown as FeatureInterface;

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRule = api.environments.preprod.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(apiRule.type).toBe("experiment");
    expect(apiRule.values).toEqual([
      { weight: 0.34, value: "a" },
      { weight: 0.33, value: "b" },
      { weight: 0.33, value: "c" },
    ]);
    expect(apiRule).not.toHaveProperty("value");
    expect(apiRule.namespace).toEqual({
      enabled: false,
      name: "",
      range: [0, 0.5],
    });
  });

  // Origin/main spreads `...rule`, so internal `savedGroups` leaks through
  // alongside derived `savedGroupTargeting`. Match that on v1 emit.
  it("preserves `savedGroups` end-to-end through v1 → v2 migration", () => {
    const organization = {
      id: "org_test",
      settings: { environments: [{ id: "preprod" }] },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const legacy = {
      id: "feat_legacy_sg",
      organization: "org_test",
      owner: "tester",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "string",
      defaultValue: "off",
      version: 1,
      tags: [],
      project: "",
      environmentSettings: {
        preprod: {
          enabled: true,
          rules: [
            {
              id: "fr_legacy_sg",
              type: "force",
              description: "",
              enabled: true,
              condition: "",
              value: "on",
              savedGroups: [{ match: "all", ids: ["sg_1", "sg_2"] }],
            },
          ],
        },
      },
    } as unknown as LegacyFeatureInterface;

    const feature = migrateRawFeatureToV2(legacy, ctx);
    expect(feature.rules[0]).toMatchObject({
      savedGroups: [{ match: "all", ids: ["sg_1", "sg_2"] }],
    });

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRule = api.environments.preprod.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(apiRule.savedGroups).toEqual([
      { match: "all", ids: ["sg_1", "sg_2"] },
    ]);
    expect(apiRule.savedGroupTargeting).toEqual([
      { matchType: "all", savedGroups: ["sg_1", "sg_2"] },
    ]);
  });

  // Origin/main's `{...rule}` spread emits any on-disk `[]` field verbatim.
  // Mirror that on the v1 feature-env path for the common collection fields.
  it("preserves empty arrays (`savedGroups`, `scheduleRules`, `values`, `variations`) end-to-end", () => {
    const organization = {
      id: "org_test",
      settings: { environments: [{ id: "preprod" }] },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const legacy = {
      id: "feat_empty_arrays",
      organization: "org_test",
      owner: "tester",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "string",
      defaultValue: "off",
      version: 1,
      tags: [],
      project: "",
      environmentSettings: {
        preprod: {
          enabled: true,
          rules: [
            {
              id: "fr_force_empty",
              type: "force",
              description: "",
              enabled: true,
              condition: "",
              value: "on",
              savedGroups: [],
              scheduleRules: [],
            },
            {
              id: "fr_exp_empty",
              type: "experiment",
              description: "",
              enabled: true,
              condition: "",
              hashAttribute: "id",
              trackingKey: "exp1",
              coverage: 1,
              values: [],
              savedGroups: [],
              scheduleRules: [],
            },
            {
              id: "fr_expref_empty",
              type: "experiment-ref",
              description: "",
              enabled: true,
              condition: "",
              experimentId: "exp_x",
              variations: [],
              savedGroups: [],
              scheduleRules: [],
            },
          ],
        },
      },
    } as unknown as LegacyFeatureInterface;

    const feature = migrateRawFeatureToV2(legacy, ctx);
    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRules = api.environments.preprod.rules as unknown as Record<
      string,
      unknown
    >[];
    const force = apiRules.find((r) => r.id === "fr_force_empty");
    const exp = apiRules.find((r) => r.id === "fr_exp_empty");
    const expRef = apiRules.find((r) => r.id === "fr_expref_empty");

    expect(force?.savedGroups).toEqual([]);
    expect(force?.scheduleRules).toEqual([]);
    expect(exp?.savedGroups).toEqual([]);
    expect(exp?.scheduleRules).toEqual([]);
    expect(exp?.values).toEqual([]);
    expect(expRef?.savedGroups).toEqual([]);
    expect(expRef?.scheduleRules).toEqual([]);
    expect(expRef?.variations).toEqual([]);
  });

  // Project-scoped feature, identical experiment rule in dev + production.
  // Exercises raw mongo doc → `new FeatureModel(raw)` → `toInterface(doc, ctx)`.
  it("preserves [] fields for project-scoped experiment rule via Mongoose", async () => {
    const { FeatureModel, toInterface } = await import(
      "back-end/src/models/FeatureModel"
    );
    const organization = {
      id: "org_test",
      settings: {
        environments: [{ id: "dev" }, { id: "production" }],
      },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const rule = {
      id: "rule_exp_proj",
      type: "experiment",
      description: "",
      enabled: true,
      condition: "{}",
      coverage: 1,
      hashAttribute: "anonId",
      trackingKey: "tk",
      value: "true",
      values: [
        { value: "false", weight: 0.5 },
        { value: "true", weight: 0.5 },
      ],
      savedGroups: [],
      savedGroupTargeting: [],
      scheduleRules: [],
      variations: [],
      prerequisites: [],
    };
    const raw = {
      id: "feat_proj_scoped",
      organization: "org_test",
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "false",
      version: 1,
      tags: [],
      project: "prj_x",
      archived: false,
      description: "",
      customFields: {},
      prerequisites: [],
      revision: {
        comment: "",
        createdBy: "",
        date: "",
        publishedBy: "",
        version: 1,
      },
      environmentSettings: {
        dev: { defaultValue: "false", enabled: false, rules: [rule] },
        production: { defaultValue: "false", enabled: false, rules: [rule] },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new FeatureModel(raw as any);
    const feature = toInterface(doc, ctx);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRule = api.environments.dev.rules[0] as unknown as Record<
      string,
      unknown
    >;

    expect(apiRule.savedGroups).toEqual([]);
    expect(apiRule.scheduleRules).toEqual([]);
    expect(apiRule.variations).toEqual([]);
  });

  // Origin/main's typed Mongoose `rules: [...]` schema seeded `[]` defaults
  // for `savedGroups`/`scheduleRules`/`variations`; our Mixed schema does
  // not, and we intentionally do NOT backfill those either.
  it("does NOT backfill [] defaults on v0 rules missing savedGroups/scheduleRules/variations", async () => {
    const { FeatureModel, toInterface } = await import(
      "back-end/src/models/FeatureModel"
    );
    const organization = {
      id: "org_v0",
      settings: { environments: [{ id: "dev" }, { id: "production" }] },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const raw = {
      id: "feat_v0_minimal",
      organization: "org_v0",
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "false",
      description: "",
      project: "prj_x",
      environments: ["dev"],
      rules: [
        {
          id: "rule_minimal",
          type: "experiment",
          description: "",
          trackingKey: "tk",
          hashAttribute: "anonId",
          value: "true",
          enabled: true,
          condition: "{}",
          values: [
            { value: "false", weight: 0.5 },
            { value: "true", weight: 0.5 },
          ],
        },
      ],
      environmentSettings: {
        production: { enabled: false },
        dev: { enabled: false },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new FeatureModel(raw as any);
    const feature = toInterface(doc, ctx);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    for (const env of ["dev", "production"] as const) {
      const apiRule = api.environments[env].rules[0] as unknown as Record<
        string,
        unknown
      >;
      expect(apiRule).not.toHaveProperty("savedGroups");
      expect(apiRule).not.toHaveProperty("scheduleRules");
      expect(apiRule).not.toHaveProperty("variations");
      // Sanity: the rule itself is still emitted, just without empty defaults.
      expect(apiRule.id).toBe("rule_minimal");
      expect(apiRule.type).toBe("experiment");
    }
  });

  // Hybrid v0/v1 doc: legacy top-level `rules` alongside `environmentSettings`
  // whose envs have `rules: []` (key present, empty). Must NOT leak the
  // legacy top-level rule through the v2 path — origin/main's
  // `updateEnvironmentSettings` skips re-copying when the key is present.
  it("ignores legacy top-level rules when env settings have empty rules: [] (hybrid v0/v1)", async () => {
    const { FeatureModel, toInterface } = await import(
      "back-end/src/models/FeatureModel"
    );
    const organization = {
      id: "org_test",
      settings: { environments: [{ id: "dev" }, { id: "production" }] },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const raw = {
      id: "feat_hybrid",
      organization: "org_test",
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "true",
      project: "",
      tags: [],
      // Legacy v0 enabled-list AND a legacy top-level rules array...
      environments: ["dev", "production"],
      rules: [
        {
          id: "rule_stale_top_level",
          type: "force",
          description: "",
          trackingKey: "tk",
          hashAttribute: "id",
          value: "true",
          enabled: true,
          condition: "{}",
        },
      ],
      // ...alongside a partially-populated environmentSettings map. The
      // per-env `rules: []` keys are PRESENT (just empty), so origin/main's
      // `updateEnvironmentSettings` does not re-copy the top-level rules.
      environmentSettings: {
        production: { rules: [], enabled: true },
        dev: { rules: [], enabled: true },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new FeatureModel(raw as any);
    const feature = toInterface(doc, ctx);

    // Top-level v2 rules array must NOT carry the legacy stale rule.
    expect(feature.rules).toEqual([]);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });
    expect(api.environments.dev.rules).toEqual([]);
    expect(api.environments.production.rules).toEqual([]);
  });

  // Sparse legacy v0/v1 docs: only `dev` exists in environmentSettings, but a
  // top-level `rules` array carries production rules implicitly. Origin/main's
  // `upgradeFeatureInterface` hard-codes `dev`+`production` env entries and
  // backfills missing ones from the top-level rules — we mirror that so a
  // production-only legacy rule isn't silently dropped on first read.
  it("backfills production from legacy top-level rules when environmentSettings only has dev (sparse v0/v1 hybrid)", async () => {
    const { FeatureModel, toInterface } = await import(
      "back-end/src/models/FeatureModel"
    );
    const organization = {
      id: "org_test",
      settings: { environments: [{ id: "dev" }, { id: "production" }] },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const raw = {
      id: "feat_sparse_v0",
      organization: "org_test",
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "true",
      project: "",
      tags: [],
      // Legacy v0 marker — empty enabled-env list.
      environments: [],
      // Top-level rule belongs on `production` per origin/main's hard-coded
      // dev+production backfill.
      rules: [
        {
          id: "rule_top_level_only",
          type: "force",
          description: "",
          trackingKey: "tk",
          hashAttribute: "id",
          value: "true",
          enabled: true,
          condition: "{}",
        },
      ],
      // Only `dev` is materialized — with its OWN rule (no `rules` key would
      // also be valid; here we test the case where dev already carries rules
      // and production is missing entirely).
      environmentSettings: {
        dev: {
          enabled: false,
          rules: [
            {
              id: "rule_dev_only",
              type: "force",
              description: "",
              trackingKey: "tk-dev",
              hashAttribute: "id",
              value: "false",
              enabled: true,
              condition: "{}",
            },
          ],
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new FeatureModel(raw as any);
    const feature = toInterface(doc, ctx);

    // Both legacy-flavored rules survive: dev's own rule + production's
    // backfilled-from-top-level rule.
    const ids = (feature.rules ?? []).map((r) => r.id).sort();
    expect(ids).toEqual(["rule_dev_only", "rule_top_level_only"]);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });
    expect(api.environments.dev.rules.map((r) => r.id)).toEqual([
      "rule_dev_only",
    ]);
    expect(api.environments.production.rules.map((r) => r.id)).toEqual([
      "rule_top_level_only",
    ]);
  });

  it("does not enroll non-(dev|production) envs lacking a rules key into top-level rule backfill", async () => {
    const { FeatureModel, toInterface } = await import(
      "back-end/src/models/FeatureModel"
    );
    // Custom envs lack a `rules` key; `dev` is stale (in envSettings, not in
    // the org list).
    const organization = {
      id: "org_test",
      settings: {
        environments: [
          { id: "custom_a" },
          { id: "custom_b" },
          { id: "production" },
        ],
      },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const topLevelRule = {
      id: "rule_prod_only",
      type: "force",
      description: "",
      trackingKey: "tk",
      hashAttribute: "id",
      value: "true",
      enabled: true,
      condition: "{}",
    };

    const raw = {
      id: "feat_no_enroll",
      organization: "org_test",
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "false",
      project: "",
      tags: [],
      rules: [topLevelRule],
      environmentSettings: {
        dev: { enabled: true, rules: [topLevelRule] },
        production: { enabled: false, rules: [topLevelRule] },
        // No `rules` key — must NOT be backfilled with `topLevelRule`.
        custom_a: { enabled: true },
        custom_b: { enabled: true, rules: [] },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new FeatureModel(raw as any);
    const feature = toInterface(doc, ctx);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });
    expect(api.environments.production.rules.map((r) => r.id)).toEqual([
      "rule_prod_only",
    ]);
    expect(api.environments.custom_a.rules).toEqual([]);
    expect(api.environments.custom_b.rules).toEqual([]);
  });

  // Catches anything Mongoose's schema/toJSON pass strips that the bare
  // `migrateRawFeatureToV2` test does not.
  it("preserves [] fields end-to-end through Mongoose toInterface (v1 on-disk)", async () => {
    const { FeatureModel, toInterface } = await import(
      "back-end/src/models/FeatureModel"
    );
    const organization = {
      id: "org_test",
      settings: {
        environments: [{ id: "dev" }, { id: "production" }],
      },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const rule = {
      id: "rule_force_empty",
      type: "force",
      description: "",
      enabled: true,
      condition: "{}",
      coverage: 1,
      hashAttribute: "id",
      trackingKey: "",
      value: "true",
      values: [
        { value: "true", weight: 0.5 },
        { value: "true", weight: 0.5 },
      ],
      savedGroups: [],
      scheduleRules: [],
      variations: [],
      prerequisites: [],
    };
    const raw = {
      id: "feat_via_mongoose",
      organization: "org_test",
      owner: "tester",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "true",
      version: 1,
      tags: [],
      project: "",
      environmentSettings: {
        dev: { enabled: false, rules: [rule] },
        production: { enabled: false, rules: [rule] },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new FeatureModel(raw as any);
    const feature = toInterface(doc, ctx);

    const v2Rule = feature.rules[0] as unknown as Record<string, unknown>;
    expect(v2Rule.savedGroups).toEqual([]);
    expect(v2Rule.scheduleRules).toEqual([]);
    expect(v2Rule.variations).toEqual([]);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRule = api.environments.dev.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(apiRule.savedGroups).toEqual([]);
    expect(apiRule.scheduleRules).toEqual([]);
    expect(apiRule.variations).toEqual([]);
  });

  // v2 path skips `flattenV1ToV2Rules` entirely; reads must NOT silently
  // drop legacy `[]` fields baked into the on-disk rule.
  it("preserves [] fields when on-disk doc is already v2 with allEnvironments", () => {
    const organization = {
      id: "org_test",
      settings: {
        environments: [{ id: "dev" }, { id: "production" }],
      },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const v2OnDiskRule = {
      id: "rule_force_v2",
      type: "force",
      description: "",
      enabled: true,
      condition: "{}",
      coverage: 1,
      hashAttribute: "id",
      trackingKey: "",
      value: "true",
      values: [
        { value: "true", weight: 0.5 },
        { value: "true", weight: 0.5 },
      ],
      savedGroups: [],
      scheduleRules: [],
      variations: [],
      prerequisites: [],
      allEnvironments: true,
    };
    const legacy = {
      id: "feat_v2_force",
      organization: "org_test",
      owner: "tester",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "true",
      version: 2,
      tags: [],
      project: "",
      environmentSettings: {
        dev: { enabled: false },
        production: { enabled: false },
      },
      rules: [v2OnDiskRule],
    } as unknown as LegacyFeatureInterface;

    const feature = migrateRawFeatureToV2(legacy, ctx);
    const v2Rule = feature.rules[0] as unknown as Record<string, unknown>;
    expect(v2Rule.savedGroups).toEqual([]);
    expect(v2Rule.scheduleRules).toEqual([]);
    expect(v2Rule.variations).toEqual([]);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRule = api.environments.dev.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(apiRule.savedGroups).toEqual([]);
    expect(apiRule.scheduleRules).toEqual([]);
    expect(apiRule.variations).toEqual([]);
    expect(apiRule.values).toEqual([
      { value: "true", weight: 0.5 },
      { value: "true", weight: 0.5 },
    ]);
  });

  // Identical force rule in dev + production with `[]` legacy fields baked
  // in; migration merges into a single `allEnvironments: true` rule. Assert
  // every empty-array field survives the merge → bucket → emit pipeline.
  it("preserves [] fields through merged-rule v1 → v2 migration", () => {
    const organization = {
      id: "org_test",
      settings: {
        environments: [{ id: "dev" }, { id: "production" }],
      },
    } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const rule = {
      id: "rule_force_merged",
      type: "force",
      description: "",
      enabled: true,
      condition: "{}",
      coverage: 1,
      hashAttribute: "id",
      trackingKey: "",
      value: "true",
      values: [
        { value: "true", weight: 0.5 },
        { value: "true", weight: 0.5 },
      ],
      savedGroups: [],
      scheduleRules: [],
      variations: [],
      prerequisites: [],
    };
    const legacy = {
      id: "feat_merged_force",
      organization: "org_test",
      owner: "tester",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "true",
      version: 1,
      tags: [],
      project: "",
      environmentSettings: {
        dev: { enabled: false, rules: [rule] },
        production: { enabled: false, rules: [rule] },
      },
    } as unknown as LegacyFeatureInterface;

    const feature = migrateRawFeatureToV2(legacy, ctx);
    expect(feature.rules).toHaveLength(1);
    expect(feature.rules[0].allEnvironments).toBe(true);
    const v2Rule = feature.rules[0] as unknown as Record<string, unknown>;
    expect(v2Rule.savedGroups).toEqual([]);
    expect(v2Rule.scheduleRules).toEqual([]);
    expect(v2Rule.variations).toEqual([]);

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRule = api.environments.dev.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(apiRule.savedGroups).toEqual([]);
    expect(apiRule.scheduleRules).toEqual([]);
    expect(apiRule.variations).toEqual([]);
    expect(apiRule.values).toEqual([
      { value: "true", weight: 0.5 },
      { value: "true", weight: 0.5 },
    ]);
  });

  it("preserves both internal `savedGroups` and derived `savedGroupTargeting`", () => {
    const organization = {
      id: "org_test",
      settings: { environments: [{ id: "preprod" }] },
    } as unknown as OrganizationInterface;

    const feature: FeatureInterface = {
      id: "feat_sg",
      organization: "org_test",
      owner: "tester",
      dateCreated: new Date("2024-01-01"),
      dateUpdated: new Date("2024-01-01"),
      valueType: "string",
      defaultValue: "off",
      version: 1,
      tags: [],
      project: "",
      environmentSettings: { preprod: { enabled: true } },
      rules: [
        {
          id: "fr_sg",
          type: "force",
          description: "",
          enabled: true,
          condition: "",
          value: "on",
          savedGroups: [{ match: "all", ids: ["sg_1", "sg_2"] }],
          allEnvironments: true,
        },
      ],
    } as unknown as FeatureInterface;

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRule = api.environments.preprod.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(apiRule.savedGroups).toEqual([
      { match: "all", ids: ["sg_1", "sg_2"] },
    ]);
    expect(apiRule.savedGroupTargeting).toEqual([
      { matchType: "all", savedGroups: ["sg_1", "sg_2"] },
    ]);
  });

  it("preserves experiment-ref rule `variations` field verbatim", () => {
    const organization = {
      id: "org_test",
      settings: { environments: [{ id: "production" }] },
    } as unknown as OrganizationInterface;

    const feature: FeatureInterface = {
      id: "feat_expref",
      organization: "org_test",
      owner: "tester",
      dateCreated: new Date("2024-01-01"),
      dateUpdated: new Date("2024-01-01"),
      valueType: "string",
      defaultValue: "control",
      version: 1,
      tags: [],
      project: "",
      environmentSettings: { production: { enabled: true } },
      rules: [
        {
          id: "fr_ref",
          type: "experiment-ref",
          description: "",
          experimentId: "exp_1",
          variations: [
            { variationId: "v0", value: "control" },
            { variationId: "v1", value: "treatment" },
          ],
          enabled: true,
          condition: "",
          allEnvironments: true,
        },
      ],
    } as unknown as FeatureInterface;

    const api = getApiFeatureObj({
      feature,
      organization,
      groupMap: new Map() as GroupMap,
      experimentMap: new Map<string, ExperimentInterface>(),
      revision: null,
      safeRolloutMap: new Map<string, SafeRolloutInterface>(),
    });

    const apiRule = api.environments.production.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(apiRule.type).toBe("experiment-ref");
    expect(apiRule.variations).toEqual([
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "treatment" },
    ]);
    expect(apiRule.experimentId).toBe("exp_1");
  });
});
