import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { getFeature, updateFeature } from "back-end/src/models/FeatureModel";
import { setupApp } from "../api/api.setup";

/**
 * Where rules live on disk after a write to a v1-shaped doc, against real Mongo.
 *
 * A v1 doc keeps its rules in `environmentSettings.<env>.rules` with an empty
 * top-level `rules` array; they're flattened JIT on read. `updateFeature`
 * holds the invariant that after any write the top-level array is the only
 * copy on disk, and backfills it from both directions:
 *
 *   - a write carrying `environmentSettings` but no `rules` must still land
 *     the rules (this half was missing — enabling a feature in a new
 *     environment silently deleted every rule it had);
 *   - a write carrying `rules` but no `environmentSettings` must still scrub
 *     the legacy env copy, so nothing is left to shadow the new array.
 */

const ORG_ID = "org_v1_rule_preservation";

const org = {
  id: ORG_ID,
  name: "V1 Rule Preservation",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "production", description: "" },
      { id: "self-hosted", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const devRule = {
  type: "force",
  id: "fr_keepme",
  description: "Employee dev instances",
  value: "true",
  enabled: true,
  condition: '{"admin": true}',
  savedGroups: [],
};

describe("updateFeature rule preservation on env-settings writes", () => {
  setupApp();
  let context: ReqContextClass;

  beforeEach(async () => {
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    await mongoose.connection
      .collection("features")
      .deleteMany({ organization: ORG_ID });
  });

  async function seed(doc: Record<string, unknown>) {
    await mongoose.connection.collection("features").insertOne({
      organization: ORG_ID,
      valueType: "boolean",
      defaultValue: "false",
      version: 1,
      dateCreated: new Date(Date.now() - 60_000),
      dateUpdated: new Date(Date.now() - 60_000),
      ...doc,
    });
  }

  async function load(id: string) {
    const feature = await getFeature(context, id);
    if (!feature) throw new Error("seed missing");
    return feature;
  }

  const rawDoc = async (id: string) =>
    await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id });

  const rawRules = async (id: string) => (await rawDoc(id))?.rules ?? [];

  it("keeps a v1 doc's env rules when a write only enables another environment", async () => {
    await seed({
      id: "v1-flag",
      rules: [],
      environmentSettings: {
        dev: { enabled: true, rules: [devRule] },
        production: { enabled: true, rules: [] },
      },
    });

    const preImage = await load("v1-flag");
    // Read flattens the legacy env rules, so the pre-image already sees them.
    expect(preImage.rules).toHaveLength(1);

    // Mirrors what publishing an enablement-only revision sends: the whole
    // env-settings map (rules already scrubbed in memory) and no `rules` key.
    await updateFeature(context, preImage, {
      environmentSettings: {
        ...preImage.environmentSettings,
        "self-hosted": { enabled: true },
      },
    });

    // Materialized onto the doc rather than dropped with the legacy copy.
    expect(await rawRules("v1-flag")).toMatchObject([
      { id: "fr_keepme", environments: ["dev"] },
    ]);
    const after = await load("v1-flag");
    expect(after.rules).toMatchObject([{ id: "fr_keepme" }]);
    expect(after.environmentSettings["self-hosted"].enabled).toBe(true);
  });

  it("leaves a v2 doc's existing flat rules untouched", async () => {
    const v2Rule = {
      ...devRule,
      allEnvironments: false,
      environments: ["dev"],
    };
    await seed({
      id: "v2-flag",
      rules: [v2Rule],
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: true },
      },
    });

    const preImage = await load("v2-flag");
    await updateFeature(context, preImage, {
      environmentSettings: {
        ...preImage.environmentSettings,
        "self-hosted": { enabled: true },
      },
    });

    expect(await rawRules("v2-flag")).toMatchObject([
      { id: "fr_keepme", environments: ["dev"] },
    ]);
  });

  it("still lets a caller replace the rules outright", async () => {
    await seed({
      id: "replace-flag",
      rules: [],
      environmentSettings: {
        dev: { enabled: true, rules: [devRule] },
        production: { enabled: true, rules: [] },
      },
    });

    const preImage = await load("replace-flag");
    await updateFeature(context, preImage, {
      environmentSettings: {
        ...preImage.environmentSettings,
        "self-hosted": { enabled: true },
      },
      rules: [],
    });

    // An explicit `rules: []` is intent, not an omission — don't resurrect.
    expect(await rawRules("replace-flag")).toHaveLength(0);
  });

  it("scrubs a v1 doc's legacy env rules when a write carries only rules", async () => {
    await seed({
      id: "scrub-flag",
      rules: [],
      environmentSettings: {
        dev: { enabled: true, rules: [devRule] },
        production: { enabled: true, rules: [] },
      },
    });

    const preImage = await load("scrub-flag");
    await updateFeature(context, preImage, {
      rules: [
        { ...devRule, id: "fr_replacement", environments: ["dev"] },
      ] as never,
    });

    const doc = await rawDoc("scrub-flag");
    expect(doc?.rules).toMatchObject([{ id: "fr_replacement" }]);
    // The legacy copy must not survive alongside the new array: left behind,
    // it re-classifies the doc as v1 on the next read and shadows the write.
    expect(doc?.environmentSettings.dev).not.toHaveProperty("rules");
    expect(doc?.environmentSettings.production).not.toHaveProperty("rules");
    // ...and the env's own non-rule state is untouched by that scrub.
    expect(doc?.environmentSettings.dev.enabled).toBe(true);

    const after = await load("scrub-flag");
    expect(after.rules).toMatchObject([{ id: "fr_replacement" }]);
  });
});
