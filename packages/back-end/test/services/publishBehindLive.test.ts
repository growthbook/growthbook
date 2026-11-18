import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { mergeDraftForAutoPublish } from "back-end/src/services/featurePublishGates";
import { repairFeatureDriftIfNeeded } from "back-end/src/services/featureDriftRepair";
import { setupApp } from "../api/api.setup";

// The flag page repairs the feature from its live record on every load, so a
// published record must hold the merge the publish landed, not the draft alone.

const ORG_ID = "org_publish_behind_live";
const org = {
  id: ORG_ID,
  name: "Publish Behind Live",
  ownerEmail: "o@test.com",
  url: "",
  dateCreated: new Date(),
  members: [{ id: "u_admin", role: "admin" }],
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "production", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const rule = (id: string, env: string) => ({
  id,
  type: "force",
  description: "",
  value: "true",
  enabled: true,
  allEnvironments: false,
  environments: [env],
});
const alice = rule("fr_alice", "dev");
const bob = rule("fr_bob", "production");

const features = () => mongoose.connection.collection("features");
const revisions = () => mongoose.connection.collection("featurerevisions");
const audits = () => mongoose.connection.collection("audits");
const ruleIds = (doc: { rules?: { id: string }[] } | null) =>
  (doc?.rules ?? []).map((r) => r.id).sort();

function context() {
  const ctx = new ReqContextClass({
    org,
    auditUser: { type: "dashboard", id: "u_admin", email: "a@t.co", name: "A" },
    user: { id: "u_admin", email: "a@t.co", name: "A" },
    role: "admin",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  ctx.hasPremiumFeature = () => true;
  return ctx;
}

// What the flag page does on load: read the feature and heal it from its live record.
async function loadFlagPage(ctx: ReqContextClass, id: string) {
  const feature = (await getFeature(ctx, id))!;
  const live = await getRevision({
    context: ctx,
    organization: ORG_ID,
    featureId: id,
    feature,
    version: feature.version,
  });
  await repairFeatureDriftIfNeeded(
    ctx,
    feature,
    live ?? undefined,
    ctx.environments,
  );
}

async function revisionLogs(id: string, version: number) {
  for (let i = 0; i < 40; i++) {
    const logs = await mongoose.connection
      .collection("featurerevisionlog")
      .find({ organization: ORG_ID, featureId: id, version })
      .sort({ _id: 1 })
      .toArray();
    if (logs.length >= 2) return logs;
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
}

describe("publishing a draft behind live", () => {
  setupApp();
  const now = new Date();

  beforeEach(async () => {
    for (const c of ["features", "featurerevisions", "audits"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
  });

  // Bob published v2 over v1 while Alice's draft, based on v1, sat open.
  async function seedBehindLive(aliceRule: object, draftBase = 1) {
    await features().insertOne({
      id: "flag",
      organization: ORG_ID,
      owner: "",
      valueType: "boolean",
      defaultValue: "false",
      version: 2,
      rules: [bob],
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: true },
      },
      dateCreated: now,
      dateUpdated: now,
    });
    const revision = (
      version: number,
      baseVersion: number,
      status: string,
      rules: object[],
    ) => ({
      organization: ORG_ID,
      featureId: "flag",
      version,
      baseVersion,
      status,
      defaultValue: "false",
      rules,
      dateCreated: now,
      dateUpdated: now,
      ...(status === "published" ? { datePublished: now } : {}),
    });
    await revisions().insertMany([
      revision(1, 0, "published", []),
      revision(2, 1, "published", [bob]),
      revision(3, draftBase, "draft", [aliceRule]),
    ]);
  }

  async function publishDraft(ctx: ReqContextClass) {
    const feature = (await getFeature(ctx, "flag"))!;
    const revision = (await getRevision({
      context: ctx,
      organization: ORG_ID,
      featureId: "flag",
      feature,
      version: 3,
    }))!;
    const { live, base } = await getLiveAndBaseRevisionsForFeature({
      context: ctx,
      feature,
      revision,
    });
    const { mergeResult } = mergeDraftForAutoPublish(
      ctx,
      feature,
      revision,
      live,
      base,
    );
    expect(mergeResult.success).toBe(true);
    await publishRevision({
      context: ctx,
      feature,
      revision,
      result: mergeResult.success ? mergeResult.result : {},
    });
  }

  const repairs = () =>
    audits()
      .find({ organization: ORG_ID, details: /autoRepair/ })
      .toArray();
  const publishedRecord = () =>
    revisions().findOne({
      organization: ORG_ID,
      featureId: "flag",
      version: 3,
    });
  const storedFeature = () =>
    features().findOne({ organization: ORG_ID, id: "flag" });

  it("keeps the newer live changes across a flag page load", async () => {
    await seedBehindLive(alice);
    const ctx = context();
    await publishDraft(ctx);

    const published = await publishedRecord();
    expect(published).toMatchObject({ status: "published", baseVersion: 2 });
    expect(ruleIds(published)).toEqual(["fr_alice", "fr_bob"]);
    const logs = await revisionLogs("flag", 3);
    expect(logs.map((l) => [l.action, l.subject])).toEqual([
      ["rebase", "on top of revision #2 at publish"],
      ["publish", ""],
    ]);

    await loadFlagPage(ctx, "flag");

    const stored = await storedFeature();
    expect(stored?.version).toBe(3);
    expect(ruleIds(stored)).toEqual(["fr_alice", "fr_bob"]);
    expect(await repairs()).toEqual([]);
  });

  it.each([
    ["behind live", 1],
    ["current", 2],
  ])(
    "drops a deleted project scope from a %s draft's record as it does from the feature",
    async (_label, draftBase) => {
      await seedBehindLive(
        { ...alice, allProjects: false, projects: ["prj_gone"] },
        draftBase,
      );
      const ctx = context();
      await publishDraft(ctx);

      const scope = (
        doc: { rules?: { id: string; projects?: string[] }[] } | null,
      ) => doc?.rules?.find((r) => r.id === "fr_alice")?.projects;
      expect(scope(await storedFeature())).toEqual([]);
      expect(scope(await publishedRecord())).toEqual([]);

      await loadFlagPage(ctx, "flag");
      expect(await repairs()).toEqual([]);
    },
  );

  it("still heals a legacy document whose environment rules shadow its live record", async () => {
    const fresh = { ...rule("fr_fresh", "production"), allEnvironments: true };
    delete (fresh as { environments?: string[] }).environments;
    await features().insertOne({
      id: "legacy",
      organization: ORG_ID,
      owner: "",
      valueType: "boolean",
      defaultValue: "false",
      version: 1,
      environmentSettings: {
        dev: { enabled: true, rules: [] },
        production: {
          enabled: true,
          rules: [
            {
              id: "fr_stale",
              type: "force",
              description: "",
              value: "true",
              enabled: true,
            },
          ],
        },
      },
      dateCreated: now,
      dateUpdated: now,
    });
    await revisions().insertOne({
      organization: ORG_ID,
      featureId: "legacy",
      version: 1,
      baseVersion: 0,
      status: "published",
      defaultValue: "false",
      rules: [fresh],
      dateCreated: now,
      dateUpdated: now,
      datePublished: now,
    });

    await loadFlagPage(context(), "legacy");

    const stored = await features().findOne({
      organization: ORG_ID,
      id: "legacy",
    });
    expect(ruleIds(stored)).toEqual(["fr_fresh"]);
    expect(stored?.environmentSettings?.production?.rules).toBeUndefined();
    const repairs = await audits()
      .find({ organization: ORG_ID, details: /autoRepair/ })
      .toArray();
    expect(repairs).toHaveLength(1);
  });
});
