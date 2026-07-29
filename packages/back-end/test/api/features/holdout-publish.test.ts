import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// Coverage for the three headline behaviors of the holdout-publish fixes:
//  1. Publishing a holdout change no longer needs `createAnalyses`. The linkage
//     back-reference on the Holdout is a side effect of an authorized flag
//     publish, so an engineer (FeaturesFullAccess, no HoldoutsFullAccess) must
//     be able to complete it — it used to throw mid-publish, after the feature
//     document had already advanced, stranding the flag.
//  2. A stranded live revision (feature.version === revision.version, still a
//     draft, diffs empty) publishes: the revision closes as published and the
//     feature version does NOT advance again.
//  3. That same revision cannot be discarded — discarding it would leave the
//     feature serving a revision that reports as never published.

const ORG_ID = "org_holdout_publish";

const org = {
  id: ORG_ID,
  name: "Holdout Publish",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [{ id: "production" }],
  },
} as unknown as OrganizationInterface;

// Engineer: FeaturesFullAccess + SDKPayloadPublish + ReadData, but NOT
// HoldoutsFullAccess — so `canUpdateHoldout` (createAnalyses) is false while
// every flag publish permission passes. Exactly the role shape that used to
// fail mid-publish.
function makeEngineerContext(): ReqContextClass {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_engineer" },
    role: "engineer",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  context.hasPremiumFeature = () => true;
  return context;
}

async function insertFeature(id: string, version = 1): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    owner: "",
    description: "",
    project: "",
    valueType: "boolean",
    defaultValue: "false",
    version,
    archived: false,
    tags: [],
    rules: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: now,
    dateUpdated: now,
  });
}

async function insertHoldout(id: string): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("experiments").insertOne({
    id: `exp_${id}`,
    organization: ORG_ID,
    project: "",
    trackingKey: id,
    name: `${id} holdout experiment`,
    status: "running",
    archived: false,
    variations: [],
    phases: [],
    dateCreated: now,
    dateUpdated: now,
  });
  await mongoose.connection.collection("holdouts").insertOne({
    id,
    organization: ORG_ID,
    name: id,
    projects: [],
    experimentId: `exp_${id}`,
    linkedExperiments: {},
    linkedFeatures: {},
    environmentSettings: { production: { enabled: true, rules: [] } },
    dateCreated: now,
    dateUpdated: now,
  });
}

async function insertRevision(
  featureId: string,
  version: number,
  status: "published" | "draft",
): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("featurerevisions").insertOne({
    id: `frev_${featureId}_${version}`,
    organization: ORG_ID,
    featureId,
    version,
    baseVersion: Math.max(version - 1, 0),
    status,
    createdBy: { type: "api_key", apiKey: "key_engineer" },
    comment: "",
    defaultValue: "false",
    rules: [],
    dateCreated: now,
    dateUpdated: now,
    ...(status === "published" ? { datePublished: now } : {}),
  });
}

// The feature is live on version 2 but that revision was never marked published
// — the stranded shape a mid-publish throw used to leave behind.
async function insertStrandedFeature(featureId: string): Promise<void> {
  await insertFeature(featureId, 2);
  await insertRevision(featureId, 1, "published");
  await insertRevision(featureId, 2, "draft");
}

describe("holdout publish", () => {
  const { app, setReqContext } = setupApp();

  it("publishes a holdout change for a role without createAnalyses and writes the linkage", async () => {
    const context = makeEngineerContext();
    setReqContext(context);
    // The relaxation is what makes this pass; assert the role really lacks
    // holdout-update authority so the test can't silently stop covering it.
    expect(context.permissions.canUpdateHoldout({ projects: [] }, {})).toBe(
      false,
    );

    await insertFeature("flag_holdout_link");
    await insertRevision("flag_holdout_link", 1, "published");
    await insertHoldout("hld_link_target");

    const setRes = await request(app)
      .put("/api/v2/features/flag_holdout_link/revisions/new/holdout")
      .send({ holdout: { id: "hld_link_target", value: "false" } })
      .set("Authorization", "Bearer foo");
    expect(setRes.status).toBe(200);
    const version = setRes.body.revision.version;

    const publishRes = await request(app)
      .post(`/api/v2/features/flag_holdout_link/revisions/${version}/publish`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(publishRes.status).toBe(200);

    const holdout = await mongoose.connection
      .collection("holdouts")
      .findOne({ id: "hld_link_target" });
    expect(holdout?.linkedFeatures?.flag_holdout_link).toBeTruthy();

    const feature = await mongoose.connection
      .collection("features")
      .findOne({ id: "flag_holdout_link" });
    expect(feature?.holdout?.id).toBe("hld_link_target");
  });

  it("publishing a stranded live revision closes it without advancing the feature version", async () => {
    setReqContext(makeEngineerContext());
    await insertStrandedFeature("flag_stranded");

    const publishRes = await request(app)
      .post("/api/v2/features/flag_stranded/revisions/2/publish")
      .send({})
      .set("Authorization", "Bearer foo");
    expect(publishRes.status).toBe(200);

    const revision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: "flag_stranded", version: 2 });
    expect(revision?.status).toBe("published");

    const feature = await mongoose.connection
      .collection("features")
      .findOne({ id: "flag_stranded" });
    expect(feature?.version).toBe(2);
  });

  it("refuses to discard the revision the feature is live on", async () => {
    setReqContext(makeEngineerContext());
    await insertStrandedFeature("flag_no_discard");

    const res = await request(app)
      .post("/api/v2/features/flag_no_discard/revisions/2/discard")
      .send({})
      .set("Authorization", "Bearer foo");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/live version of the Feature Flag/);

    const revision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: "flag_no_discard", version: 2 });
    expect(revision?.status).toBe("draft");
  });
});
