import { FeatureInterface, LegacyFeatureInterface } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import { ExperimentInterface } from "shared/types/experiment";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { GroupMap } from "shared/types/saved-group";
import { getApiFeatureObj } from "back-end/src/services/features";
import { buildFeatureInterface } from "back-end/src/models/FeatureModel";
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
      } as unknown as Parameters<typeof buildFeatureInterface>[0]["rules"][0],
    ],
  } as LegacyFeatureInterface;
}

describe("getApiFeatureObj: env-less org backfill", () => {
  it("emits the migrated rule in every backfilled env (dev + production)", () => {
    const organization = { id: "org_test" } as unknown as OrganizationInterface;
    const ctx = { org: organization } as unknown as ReqContext;

    const feature: FeatureInterface = buildFeatureInterface(
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
