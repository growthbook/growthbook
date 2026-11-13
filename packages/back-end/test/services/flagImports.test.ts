import { GrowthBook } from "@growthbook/growthbook";
import { buildFlagImportFeatureBody, planFlagImport } from "shared/util";
import { FlagsJson, flagsJsonValidator } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { FeatureDefinition } from "shared/types/sdk";
import { getFeatureDefinition } from "back-end/src/util/features";
import { addIdsToFlatRules } from "back-end/src/services/features";
import { mapV2ApiRuleToFeatureRule } from "back-end/src/api/features/v2Shared";

const ENVIRONMENTS = ["dev", "staging", "production"];

// The Quick start flags from the local flags.ts guide, as JSON, with one rule
// made production-only to cover a condition that mixes env with targeting.
const guideExample: FlagsJson = flagsJsonValidator.parse({
  features: {
    newCheckout: {
      defaultValue: false,
      rules: [
        { condition: { env: { $in: ["dev", "staging"] } }, force: true },
        { force: true, coverage: 0.2, hashAttribute: "id" },
      ],
    },
    uploadLimitMb: {
      defaultValue: 10,
      rules: [{ condition: { plan: "pro", env: "production" }, force: 20 }],
    },
  },
});

// The Feature Flag an import creates, built the way POST /v2/features builds it.
function importedFeatures(file: FlagsJson): FeatureInterface[] {
  return planFlagImport(file).flags.map((flag) => {
    const { body } = buildFlagImportFeatureBody(flag, {
      environmentIds: ENVIRONMENTS,
      experiments: {},
    });
    const rules = (body.rules ?? []).map((rule) =>
      mapV2ApiRuleToFeatureRule(rule),
    );
    addIdsToFlatRules(rules, body.id);
    return {
      id: body.id,
      organization: "org_1",
      owner: "",
      description: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: body.valueType,
      defaultValue: body.defaultValue,
      version: 1,
      archived: false,
      environmentSettings: Object.fromEntries(
        Object.entries(body.environments ?? {}).map(([env, settings]) => [
          env,
          { enabled: !!settings.enabled, rules: [] },
        ]),
      ),
      rules,
    } as FeatureInterface;
  });
}

function servedPayload(
  file: FlagsJson,
  environment: string,
): Record<string, FeatureDefinition> {
  const served: Record<string, FeatureDefinition> = {};
  importedFeatures(file).forEach((feature) => {
    const definition = getFeatureDefinition({
      feature,
      environment,
      groupMap: new Map(),
      experimentMap: new Map(),
      safeRolloutMap: new Map(),
      capabilities: undefined,
    });
    if (definition) served[feature.id] = definition;
  });
  return served;
}

describe("the payload GrowthBook serves after a flags.json import", () => {
  it("is the file with env resolved for each environment", () => {
    const rollout = {
      force: true,
      coverage: 0.2,
      hashAttribute: "id",
      seed: "newCheckout",
      hashVersion: 1,
    };
    expect(servedPayload(guideExample, "dev")).toEqual({
      newCheckout: {
        defaultValue: false,
        rules: [{ force: true }, rollout],
      },
      uploadLimitMb: { defaultValue: 10 },
    });
    expect(servedPayload(guideExample, "production")).toEqual({
      newCheckout: { defaultValue: false, rules: [rollout] },
      uploadLimitMb: {
        defaultValue: 10,
        rules: [{ force: 20, condition: { plan: "pro" } }],
      },
    });
  });

  it("gives every user the value the local file gave them", () => {
    const users = Array.from({ length: 500 }, (_, i) => ({
      id: `user-${i}`,
      plan: i % 3 === 0 ? "pro" : "free",
    }));
    const keys = Object.keys(guideExample.features);
    let inRollout = 0;

    ENVIRONMENTS.forEach((env) => {
      const served = servedPayload(guideExample, env);
      users.forEach((user) => {
        const local = new GrowthBook({
          attributes: { ...user, env },
        }).initSync({ payload: guideExample });
        const hosted = new GrowthBook({ attributes: user }).initSync({
          payload: { features: served },
        });
        keys.forEach((key) => {
          expect(hosted.evalFeature(key).value).toEqual(
            local.evalFeature(key).value,
          );
        });
        if (env === "production" && local.evalFeature("newCheckout").value) {
          inRollout++;
        }
      });
    });

    // The rollout really splits these users, so the comparison means something.
    expect(inRollout).toBeGreaterThan(50);
    expect(inRollout).toBeLessThan(150);
  });
});
