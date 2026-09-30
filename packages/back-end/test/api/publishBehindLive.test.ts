import mongoose from "mongoose";
import type { Request, Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { mergeDraftForAutoPublish } from "back-end/src/services/experiment-feature";
import { getFeatureById } from "back-end/src/controllers/features";
import { setupApp } from "./api.setup";

// A draft published over a newer live version lands its merge on the feature.
// The published record must hold that same merge: the flag page repairs the
// feature from its live record on every load, and a record that still held the
// draft alone rewrote the newer live changes away.

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

// The flag page load, which runs the drift repair.
async function loadFlagPage(id: string) {
  const req = {
    params: { id },
    query: {},
    headers: {},
    body: {},
    organization: org,
    userId: "u_admin",
    email: "a@t.co",
    name: "A",
    teams: [],
    audit: jest.fn(),
  } as unknown as AuthRequest<null, { id: string }, { v?: string }>;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  await getFeatureById(req, res);
  return res;
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

  it("keeps the newer live changes across a flag page load", async () => {
    // Bob published v2 over v1 while Alice's draft, based on v1, sat open.
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
    await revisions().insertMany([
      {
        organization: ORG_ID,
        featureId: "flag",
        version: 1,
        baseVersion: 0,
        status: "published",
        defaultValue: "false",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
        datePublished: now,
      },
      {
        organization: ORG_ID,
        featureId: "flag",
        version: 2,
        baseVersion: 1,
        status: "published",
        defaultValue: "false",
        rules: [bob],
        dateCreated: now,
        dateUpdated: now,
        datePublished: now,
      },
      {
        organization: ORG_ID,
        featureId: "flag",
        version: 3,
        baseVersion: 1,
        status: "draft",
        defaultValue: "false",
        rules: [alice],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);

    const ctx = context();
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

    const published = await revisions().findOne({
      organization: ORG_ID,
      featureId: "flag",
      version: 3,
    });
    expect(published).toMatchObject({ status: "published", baseVersion: 2 });
    expect(ruleIds(published)).toEqual(["fr_alice", "fr_bob"]);
    await new Promise((r) => setTimeout(r, 50));
    const logs = await mongoose.connection
      .collection("featurerevisionlog")
      .find({ organization: ORG_ID, featureId: "flag", version: 3 })
      .sort({ _id: 1 })
      .toArray();
    expect(logs.map((l) => [l.action, l.subject])).toEqual([
      ["rebase", "on top of revision #2 at publish"],
      ["publish", ""],
    ]);

    const res = await loadFlagPage("flag");
    expect((res.status as jest.Mock).mock.calls[0]?.[0]).toBe(200);

    const stored = await features().findOne({
      organization: ORG_ID,
      id: "flag",
    });
    expect(stored?.version).toBe(3);
    expect(ruleIds(stored)).toEqual(["fr_alice", "fr_bob"]);
    const repairs = await audits()
      .find({ organization: ORG_ID, details: /autoRepair/ })
      .toArray();
    expect(repairs).toEqual([]);
  });

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

    await loadFlagPage("legacy");

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
