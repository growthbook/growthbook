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

let logClock = Date.now();
async function seedRevisionLog(
  featureId: string,
  version: number,
  action: string,
  value: string,
  subject = "rule",
) {
  // Strictly increasing timestamps so replay ordering is deterministic
  logClock += 1000;
  await mongoose.connection.collection("featurerevisionlog").insertOne({
    id: `frl_${Math.random().toString(36).slice(2)}`,
    organization: ORG_ID,
    featureId,
    version,
    dateCreated: new Date(logClock),
    dateUpdated: new Date(logClock),
    user: { type: "dashboard", id: "u1", email: "test@test.com", name: "" },
    action,
    subject,
    value,
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

  it("reports legacy per-env rules on disk but neither repair action touches them", async () => {
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
      mode: "drift",
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("skipped");

    // Doc untouched: legacy cruft stays on disk (read path handles it)
    const raw = await getRawFeature("feat_cruft");
    expect(raw.rules.map((r) => r.id)).toEqual(["fr_keep"]);
    expect(raw.environmentSettings.production.rules).toHaveLength(1);
  });

  it("drift fix SKIPS features whose live revision is sparse (never wipes serving rules)", async () => {
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
    expect(plan.proposals[0].notes.join(" ")).toContain("SKIP");

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
      mode: "drift",
    });
    expect(results[0].status).toBe("skipped");
    expect(results[0].actions.join(" ")).toContain("manual review");

    // Neither side modified
    const raw = await getRawFeature("feat_sparse_rev");
    expect(raw.rules.map((r) => r.id)).toEqual(["fr_live"]);
    const revision = await getRawRevision("feat_sparse_rev", 1);
    expect(revision?.rules ?? []).toHaveLength(0);
  });

  it("drift fix rewrites the feature FROM its live revision when the feature is behind", async () => {
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
      mode: "drift",
    });
    expect(results[0].status).toBe("repaired");

    const raw = await getRawFeature("feat_behind");
    expect(raw.rules.map((r) => r.id).sort()).toEqual(["fr_rev", "fr_staging"]);
  });

  it("reports phantom-published and missing live revisions without fixing them", async () => {
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

    for (const mode of ["drift", "corruptDrafts"] as const) {
      const results = await applyOrgFeatureRepairs(context, {
        repairedBy: "admin@test.com",
        mode,
      });
      expect(results[0].status).toBe("skipped");
    }

    // Nothing was created or modified
    const live = await getRawRevision("feat_phantom", 2);
    expect(live).toBeNull();
    const phantom = await getRawRevision("feat_phantom", 3);
    expect(phantom?.status).toBe("published");
    const raw = await getRawFeature("feat_phantom");
    expect(raw.rules.map((r) => r.id)).toEqual(["fr_main"]);
    expect(raw.version).toBe(2);
  });

  it("repairs corrupt drafts env-scoped (corruptDrafts mode only)", async () => {
    const context = makeContext();
    const rules = [forceRule("fr_live2", ["production"])];
    await seedFeature("feat_draft", { rules });
    await seedRevision("feat_draft", 1, { rules });
    await seedRevision("feat_draft", 2, {
      status: "approved",
      datePublished: null,
      publishedBy: null,
      comment: "my draft",
      rules: [],
    });

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].corruptDrafts).toMatchObject([
      { version: 2, wipedEnvs: ["production"] },
    ]);

    // Drift mode must NOT touch the draft
    const driftResults = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
      mode: "drift",
    });
    expect(driftResults[0].status).toBe("skipped");
    let draft = await getRawRevision("feat_draft", 2);
    expect(draft?.status).toBe("approved");
    expect(draft?.rules).toHaveLength(0);

    // corruptDrafts mode restores the wiped env and voids the approval
    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
      mode: "corruptDrafts",
    });
    expect(results[0].status).toBe("repaired");
    expect(results[0].actions.join(" ")).toContain("repaired draft v2");

    draft = await getRawRevision("feat_draft", 2);
    expect(draft?.status).toBe("draft");
    expect((draft?.rules ?? []).map((r) => r.id)).toEqual(["fr_live2"]);
    expect(draft?.comment).toContain("my draft");
    expect(draft?.comment).toContain("other draft edits were preserved");

    // Feature doc untouched, and a re-scan no longer flags the draft
    const raw = await getRawFeature("feat_draft");
    expect(raw.rules.map((r) => r.id)).toEqual(["fr_live2"]);
    const rescan = await scanOrgFeatureRepairs(context);
    expect(rescan.findings).toHaveLength(0);
  });

  it("replays unambiguous edit logs to rebuild the wiped env, preserving other draft edits", async () => {
    const context = makeContext();
    const rules = [
      forceRule("fr_p1", ["production"]),
      forceRule("fr_p2", ["production"]),
      forceRule("fr_s1", ["staging"]),
    ];
    await seedFeature("feat_replay", { rules });
    await seedRevision("feat_replay", 1, { rules });
    // The author: deleted fr_p1, added fr_p3 (production), added fr_new
    // (staging) — then a corrupted write wiped production's rules while the
    // staging edits survived.
    await seedRevision("feat_replay", 2, {
      status: "draft",
      datePublished: null,
      publishedBy: null,
      rules: [
        forceRule("fr_s1", ["staging"]),
        forceRule("fr_new", ["staging"]),
      ],
    });
    await seedRevisionLog(
      "feat_replay",
      2,
      "delete rule",
      JSON.stringify(forceRule("fr_p1", ["production"])),
      "rule fr_p1",
    );
    await seedRevisionLog(
      "feat_replay",
      2,
      "add rule",
      JSON.stringify(forceRule("fr_p3", ["production"])),
      "to production",
    );
    await seedRevisionLog(
      "feat_replay",
      2,
      "add rule",
      JSON.stringify(forceRule("fr_new", ["staging"])),
      "to staging",
    );

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    const corrupt = scan.findings[0].corruptDrafts;
    expect(corrupt).toMatchObject([{ version: 2, wipedEnvs: ["production"] }]);
    expect(corrupt[0].envPlans).toEqual([
      {
        env: "production",
        source: "replay",
        orderUncertain: false,
        reason: null,
        ruleCount: 2,
      },
    ]);

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
      mode: "corruptDrafts",
    });
    expect(results[0].status).toBe("repaired");
    expect(results[0].actions.join(" ")).toContain("replayed from edit logs");

    const draft = await getRawRevision("feat_replay", 2);
    // Staging edits intact, production rebuilt as base minus fr_p1 plus fr_p3
    expect((draft?.rules ?? []).map((r) => r.id).sort()).toEqual([
      "fr_new",
      "fr_p2",
      "fr_p3",
      "fr_s1",
    ]);
    const prodRules = (draft?.rules ?? []).filter((r) =>
      r.environments.includes("production"),
    );
    expect(prodRules.map((r) => r.id)).toEqual(["fr_p2", "fr_p3"]);
  });

  it("falls back to a live-state restore when logs contain non-replayable entries", async () => {
    const context = makeContext();
    const rules = [forceRule("fr_live3", ["production"])];
    await seedFeature("feat_ambig", { rules });
    await seedRevision("feat_ambig", 1, { rules });
    await seedRevision("feat_ambig", 2, {
      status: "draft",
      datePublished: null,
      publishedBy: null,
      rules: [],
    });
    // A rebase can rewrite rules wholesale — replay must bail
    await seedRevisionLog("feat_ambig", 2, "rebase", JSON.stringify({}));

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings[0].corruptDrafts[0].envPlans).toEqual([
      {
        env: "production",
        source: "live",
        orderUncertain: false,
        reason: 'non-replayable "rebase" entry',
        ruleCount: 1,
      },
    ]);

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
      mode: "corruptDrafts",
    });
    expect(results[0].status).toBe("repaired");
    expect(results[0].actions.join(" ")).toContain("restored from live state");

    const draft = await getRawRevision("feat_ambig", 2);
    expect((draft?.rules ?? []).map((r) => r.id)).toEqual(["fr_live3"]);
  });

  it("re-adds the wiped env to a rule the draft still has for other envs (no duplicates)", async () => {
    const context = makeContext();
    const rules = [forceRule("fr_both", ["production", "staging"])];
    await seedFeature("feat_merge", { rules });
    await seedRevision("feat_merge", 1, { rules });
    // Corruption stripped production from the rule's footprint
    await seedRevision("feat_merge", 2, {
      status: "draft",
      datePublished: null,
      publishedBy: null,
      rules: [forceRule("fr_both", ["staging"])],
    });

    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
      mode: "corruptDrafts",
    });
    expect(results[0].status).toBe("repaired");

    const draft = await getRawRevision("feat_merge", 2);
    expect(draft?.rules).toHaveLength(1);
    expect(draft?.rules[0].id).toBe("fr_both");
    expect([...draft!.rules[0].environments].sort()).toEqual([
      "production",
      "staging",
    ]);
  });

  it("downgrades emptied drafts to a note when delete-rule logs account for every removed rule", async () => {
    const context = makeContext();
    const rules = [
      forceRule("fr_a", ["production"]),
      forceRule("fr_b", ["production"]),
    ];
    await seedFeature("feat_intent", { rules });
    await seedRevision("feat_intent", 1, { rules });
    // Draft empties production (2 live rules) — but the author deleted both
    // rules through normal write paths, which always log. One entry is in
    // the log collection (v1 API shape), one embedded on the revision doc
    // (UI shape with the full rule JSON).
    await seedRevision("feat_intent", 2, {
      status: "draft",
      datePublished: null,
      publishedBy: null,
      rules: [],
      log: [
        {
          user: { type: "dashboard", id: "u1", email: "t@t.com", name: "" },
          timestamp: new Date(),
          action: "delete rule",
          subject: "rule fr_a",
          value: JSON.stringify(forceRule("fr_a", ["production"])),
        },
      ],
    });
    await seedRevisionLog(
      "feat_intent",
      2,
      "delete rule",
      JSON.stringify({ environment: "production" }),
    );

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].corruptDrafts).toHaveLength(0);
    expect(scan.findings[0].emptiedDraftsWithHistory).toMatchObject([
      { version: 2, wipedEnvs: ["production"] },
    ]);

    // The reset action must not touch an accounted-for draft
    const results = await applyOrgFeatureRepairs(context, {
      repairedBy: "admin@test.com",
      mode: "corruptDrafts",
    });
    expect(results[0].status).toBe("skipped");
    const draft = await getRawRevision("feat_intent", 2);
    expect(draft?.status).toBe("draft");
    expect(draft?.rules).toHaveLength(0);
  });

  it("keeps flagging emptied drafts whose logs can't account for all removed rules", async () => {
    const context = makeContext();
    const rules = [
      forceRule("fr_x", ["production"]),
      forceRule("fr_y", ["production"]),
    ];
    await seedFeature("feat_partial", { rules });
    await seedRevision("feat_partial", 1, { rules });
    await seedRevision("feat_partial", 2, {
      status: "draft",
      datePublished: null,
      publishedBy: null,
      rules: [],
    });
    // Only one logged deletion for an env that lost two rules
    await seedRevisionLog(
      "feat_partial",
      2,
      "delete rule",
      JSON.stringify({ environment: "production" }),
    );

    const scan = await scanOrgFeatureRepairs(context);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].emptiedDraftsWithHistory).toHaveLength(0);
    expect(scan.findings[0].corruptDrafts).toMatchObject([
      { version: 2, wipedEnvs: ["production"] },
    ]);
  });
});
