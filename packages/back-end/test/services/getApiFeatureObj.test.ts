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
// `getEnvironments` backfill. Read path backfilled, emit path didn't, so
// `applicableEnvs` was empty and `ruleFootprint` resolved to []. Reproduces
// the "prod-like diff" workflow: v0 mongo doc → JIT migrate → v1 API.

// Real prod feature: pre-revisions v0, inline `type: "experiment"` rule,
// no `environmentSettings`, no `environments`.
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
// runs `toApiNamespace`. Pin the feature-env shape against accidental fold.
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
      dateCreated: new Date("2024-01-01"),
      dateUpdated: new Date("2024-01-01"),
      valueType: "string",
      defaultValue: "50_DISCOUNT",
      version: 1,
      tags: [],
      project: "",
      environmentSettings: { preprod: { enabled: true } },
      rules: [
        {
          id: "fr_19g61mlb4ulhxp",
          type: "experiment",
          description: "",
          trackingKey: "show-coupon-booking",
          hashAttribute: "id",
          values: [
            { weight: 0.34, value: "50_DISCOUNT" },
            { weight: 0.33, value: "40_DISCOUNT" },
            { weight: 0.33, value: "1+1_PACK" },
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
      { weight: 0.34, value: "50_DISCOUNT" },
      { weight: 0.33, value: "40_DISCOUNT" },
      { weight: 0.33, value: "1+1_PACK" },
    ]);
    expect(apiRule).not.toHaveProperty("value");
    expect(apiRule.namespace).toEqual({
      enabled: false,
      name: "",
      range: [0, 0.5],
    });
  });

  // Legacy v1 doc → JIT migrate → v1 API. Origin/main spreads `...rule`, so
  // internal `savedGroups` leaks through alongside derived `savedGroupTargeting`.
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
      dateCreated: new Date("2024-01-01"),
      dateUpdated: new Date("2024-01-01"),
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
      dateCreated: new Date("2024-01-01"),
      dateUpdated: new Date("2024-01-01"),
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
