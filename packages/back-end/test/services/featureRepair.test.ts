import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import {
  applyOrgFeatureRepairs,
  planOrgFeatureRepairs,
  scanOrgFeatureRepairs,
} from "back-end/src/services/featureRepair";
import { setupApp } from "../api/api.setup";

// Admin feature-repair tool: detects features/revisions stored in
// inconsistent or legacy on-disk shapes within one org and repairs them
// without ever reducing the feature's currently-served rules.

const ORG_ID = "org_feature_repair_test";

const org = {
  id: ORG_ID,
  name: "Feature Repair Test",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [
      { id: "production", description: "" },
      { id: "staging", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

function makeContext() {
  return new ReqContextClass({
    org,
    auditUser: null,
    role: "admin",
  });
}

const forceRule = (id: string, envs: string[]) => ({
  id,
  type: "force",
  description: "",
  value: "on",
  condition: "{}",
  savedGroups: [],
  enabled: true,
  allEnvironments: false,
  environments: envs,
});

async function seedFeature(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    version: 1,
    defaultValue: "off",
    valueType: "string",
    owner: "",
    description: "",
    project: "",
    tags: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    rules: [],
    environmentSettings: {
      production: { enabled: true },
      staging: { enabled: true },
    },
    archived: false,
    ...overrides,
  });
}

async function seedRevision(
  featureId: string,
  version: number,
  overrides: Record<string, unknown> = {},
) {
  await mongoose.connection.collection("featurerevisions").insertOne({
    organization: ORG_ID,
    featureId,
    version,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: new Date(),
    createdBy: { type: "api_key", apiKey: "key_test" },
    baseVersion: version - 1,
    status: "published",
    publishedBy: { type: "api_key", apiKey: "key_test" },
    comment: "",
    defaultValue: "off",
    rules: [],
    environmentsEnabled: { production: true, staging: true },
    ...overrides,
  });
}

async function getRawFeature(id: string) {
  const doc = await mongoose.connection
    .collection("features")
    .findOne({ organization: ORG_ID, id });
  if (!doc) throw new Error(`feature ${id} missing`);
  return doc;
}

async function getRawRevision(featureId: string, version: number) {
  return mongoose.connection
    .collection("featurerevisions")
    .findOne({ organization: ORG_ID, featureId, version });
}

describe("featureRepair service", () => {
  setupApp();

  it("flags nothing for a consistent feature", async () => {
    const context = makeContext();
    const rules = [forceRule("fr_ok", ["production"])];
    await seedFeature("feat_clean", { rules });
    await seedRevision("feat_clean", 1, { rules });

    const result = await scanOrgFeatureRepairs(context);
    expect(result.featuresScanned).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it("scrubs legacy per-env rules left on disk without changing serving state", async () => {
    const context = makeContext();
    const rules = [forceRule("fr_keep", ["production"])];
    await seedFeature("feat_cruft", {
      rules,
      environmentSettings: {
        // Legacy v1 rules array still on disk alongside the v2 top-level rules
        production: { enabled: true, rules: [forceRule("fr_stale", [])] },
        staging: { enabled: true },
      },
    });
    await seedRevision("feat_cruft", 1, { rules });

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].legacyEnvRulesOnDisk).toEqual(["production"]);

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("repaired");

    const raw = await getRawFeature("feat_cruft");
    // Serving rules unchanged, legacy env rules gone from disk
    expect(raw.rules.map((r) => r.id)).toEqual(["fr_keep"]);
    expect(raw.environmentSettings.production.rules ?? []).toHaveLength(0);

    // Idempotent: a re-scan finds nothing
    const rescan = await scanOrgFeatureRepairs(context);
    expect(rescan.findings).toHaveLength(0);
  });

  it("syncs a sparse live revision FROM the feature (never wipes serving rules)", async () => {
    const context = makeContext();
    const rules = [forceRule("fr_live", ["production", "staging"])];
    await seedFeature("feat_sparse_rev", { rules });
    // Live revision doc lost its rules (the dangerous self-heal baseline)
    await seedRevision("feat_sparse_rev", 1, { rules: [] });

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].drift?.direction).toBe("revision_from_feature");

    const plan = await planOrgFeatureRepairs(context, { page: 1, limit: 10 });
    expect(plan.total).toBe(1);
    expect(plan.proposals[0].liveRevision?.version).toBe(1);

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
    });
    expect(results[0].status).toBe("repaired");

    const raw = await getRawFeature("feat_sparse_rev");
    expect(raw.rules.map((r) => r.id)).toEqual(["fr_live"]);
    const revision = await getRawRevision("feat_sparse_rev", 1);
    expect((revision?.rules ?? []).map((r) => r.id)).toEqual(["fr_live"]);
  });

  it("rewrites the feature FROM its live revision when the feature is behind", async () => {
    const context = makeContext();
    const revisionRules = [forceRule("fr_rev", ["production"])];
    // Feature doc lost a production rule the live revision still has,
    // but it still serves rules in staging — same shape production's GET
    // self-heal repairs.
    await seedFeature("feat_behind", {
      rules: [forceRule("fr_staging", ["staging"])],
    });
    await seedRevision("feat_behind", 1, {
      rules: [...revisionRules, forceRule("fr_staging", ["staging"])],
    });

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].drift?.direction).toBe("feature_from_revision");

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
    });
    expect(results[0].status).toBe("repaired");

    const raw = await getRawFeature("feat_behind");
    expect(raw.rules.map((r) => r.id).sort()).toEqual(["fr_rev", "fr_staging"]);
  });

  it("discards phantom-published revisions and backfills a missing live revision", async () => {
    const context = makeContext();
    const rules = [forceRule("fr_main", ["production"])];
    // No revision doc at the feature's version, plus a revision marked
    // published ABOVE the feature's version whose changes were never applied.
    await seedFeature("feat_phantom", { rules, version: 2 });
    await seedRevision("feat_phantom", 3, { rules: [] });

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].missingLiveRevision).toBe(true);
    expect(scan.findings[0].phantomPublishedVersions).toEqual([3]);

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
    });
    expect(results[0].status).toBe("repaired");

    const live = await getRawRevision("feat_phantom", 2);
    expect(live?.status).toBe("published");
    expect((live?.rules ?? []).map((r) => r.id)).toEqual(["fr_main"]);

    const phantom = await getRawRevision("feat_phantom", 3);
    expect(phantom?.status).toBe("discarded");
    expect(phantom?.comment).toContain("never applied");

    // Feature doc untouched
    const raw = await getRawFeature("feat_phantom");
    expect(raw.rules.map((r) => r.id)).toEqual(["fr_main"]);
    expect(raw.version).toBe(2);
  });

  it("flags drafts that empty serving envs but does not modify them", async () => {
    const context = makeContext();
    const rules = [forceRule("fr_live2", ["production"])];
    await seedFeature("feat_draft", { rules });
    await seedRevision("feat_draft", 1, { rules });
    await seedRevision("feat_draft", 2, {
      status: "draft",
      datePublished: null,
      publishedBy: null,
      rules: [],
    });

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].corruptDrafts).toEqual([
      { version: 2, wipedEnvs: ["production"] },
    ]);

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
    });
    // Flagged only — the draft itself must remain untouched
    const draft = await getRawRevision("feat_draft", 2);
    expect(draft?.status).toBe("draft");
    expect(draft?.rules).toHaveLength(0);
    expect(results[0].actions.join(" ")).toContain("manual review");
  });
});
