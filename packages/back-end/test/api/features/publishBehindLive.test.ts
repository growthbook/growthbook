import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// The REST publish of a draft behind live lands the merge on the feature and
// records that same merge on the published revision.

const ORG_ID = "org_rest_publish_behind_live";
const FLAG = "flag";
const org = {
  id: ORG_ID,
  name: "REST Publish Behind Live",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
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
const ruleIds = (doc: { rules?: { id: string }[] } | null) =>
  (doc?.rules ?? []).map((r) => r.id).sort();

async function seed() {
  const now = new Date();
  // Bob published v2 over v1 while Alice's draft, based on v1, sat open.
  await mongoose.connection.collection("features").insertOne({
    id: FLAG,
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
    featureId: FLAG,
    version,
    baseVersion,
    status,
    defaultValue: "false",
    rules,
    dateCreated: now,
    dateUpdated: now,
    ...(status === "published" ? { datePublished: now } : {}),
  });
  await mongoose.connection
    .collection("featurerevisions")
    .insertMany([
      revision(1, 0, "published", []),
      revision(2, 1, "published", [bob]),
      revision(3, 1, "draft", [alice]),
    ]);
}

async function revisionLogs(version: number) {
  for (let i = 0; i < 40; i++) {
    const logs = await mongoose.connection
      .collection("featurerevisionlog")
      .find({ organization: ORG_ID, featureId: FLAG, version })
      .sort({ _id: 1 })
      .toArray();
    if (logs.length >= 2) return logs;
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
}

describe("POST /api/v2/features/:id/revisions/:version/publish behind live", () => {
  const { app, setReqContext } = setupApp();

  beforeEach(async () => {
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_admin" },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    context.hasPremiumFeature = () => true;
    setReqContext(context);
    for (const c of ["features", "featurerevisions", "featurerevisionlog"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await seed();
  });

  it("records the merge on the published revision and in its history", async () => {
    const res = await request(app)
      .post(`/api/v2/features/${FLAG}/revisions/3/publish`)
      .send({ comment: "alice" })
      .set("Authorization", "Bearer foo");
    expect(res.status).toBe(200);

    const feature = await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: FLAG });
    expect(feature?.version).toBe(3);
    expect(ruleIds(feature)).toEqual(["fr_alice", "fr_bob"]);

    const published = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: FLAG, version: 3 });
    expect(published).toMatchObject({ status: "published", baseVersion: 2 });
    expect(ruleIds(published)).toEqual(ruleIds(feature));

    const logs = await revisionLogs(3);
    expect(logs.map((l) => [l.action, l.subject])).toEqual([
      ["rebase", "on top of revision #2 at publish"],
      ["publish", ""],
    ]);
  });
});
