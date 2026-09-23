import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { postFeatureSync } from "back-end/src/controllers/features";
import {
  getFeature,
  updateNextScheduledDate,
} from "back-end/src/models/FeatureModel";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

// The feature document has one guarded writer for what a revision owns (the
// landing) and targeted writes for the rest. Neither may put a stale read
// back over a rival's publish.

const ORG_ID = "org_feature_doc_writes";
const FLAG = "synced_flag";
const org = {
  id: ORG_ID,
  name: "Feature doc writes",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

setupApp();

const features = () => mongoose.connection.collection("features");
const revisions = () => mongoose.connection.collection("featurerevisions");

async function seed() {
  for (const c of [features(), revisions()]) {
    await c.deleteMany({ organization: ORG_ID });
  }
  const stamp = new Date(Date.now() - 60_000);
  await features().insertOne({
    id: FLAG,
    organization: ORG_ID,
    owner: "",
    description: "before",
    valueType: "string",
    defaultValue: "a",
    version: 1,
    archived: false,
    tags: [],
    rules: [],
    environmentSettings: { production: { enabled: true } },
    prerequisites: [],
    dateCreated: stamp,
    dateUpdated: stamp,
  });
  await revisions().insertOne({
    id: `frev_${FLAG}_1`,
    organization: ORG_ID,
    featureId: FLAG,
    version: 1,
    baseVersion: 0,
    status: "published",
    createdBy: { type: "dashboard", id: "u_admin", email: "a@t.co", name: "A" },
    comment: "",
    defaultValue: "a",
    rules: [],
    dateCreated: stamp,
    dateUpdated: stamp,
    datePublished: stamp,
  });
}

describe("postFeatureSync", () => {
  const call = async (body: Record<string, unknown>) => {
    const captured: { status?: number; body?: { feature?: unknown } } = {};
    const res = {
      locals: {
        eventAudit: {
          type: "dashboard",
          id: "u_admin",
          email: "a@t.co",
          name: "A",
        },
      },
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(payload: { feature?: unknown }) {
        captured.body = payload;
        return this;
      },
    } as unknown as Response;
    await postFeatureSync(
      {
        params: { id: FLAG },
        body,
        organization: org,
        userId: "u_admin",
        email: "a@t.co",
        name: "A",
        query: {},
        headers: {},
        audit: jest.fn(),
      } as unknown as Parameters<typeof postFeatureSync>[0],
      res,
    );
    return captured;
  };

  beforeEach(seed);

  it("lands rules and metadata on the document through the revision", async () => {
    const rule = { type: "force", id: "fr_sync", value: "b", enabled: true };
    const { status } = await call({
      description: "after",
      environmentSettings: { production: { rules: [rule] } },
    });
    expect(status).toBe(200);

    const doc = await features().findOne({ organization: ORG_ID, id: FLAG });
    expect(doc?.version).toBe(2);
    expect(doc?.description).toBe("after");
    expect(doc?.rules).toHaveLength(1);
    expect(doc?.rules[0]).toMatchObject({ id: "fr_sync", value: "b" });
    const published = await revisions().findOne({
      organization: ORG_ID,
      featureId: FLAG,
      version: 2,
    });
    expect(published?.status).toBe("published");
    expect(published?.rules[0]).toMatchObject({ id: "fr_sync" });
  });

  it("writes nothing when the sync matches the stored feature", async () => {
    const before = await features().findOne({ organization: ORG_ID, id: FLAG });
    const { status } = await call({
      description: "before",
      environmentSettings: { production: { rules: [] } },
    });
    expect(status).toBe(200);
    const after = await features().findOne({ organization: ORG_ID, id: FLAG });
    expect(after?.version).toBe(1);
    expect(after?.dateUpdated).toEqual(before?.dateUpdated);
  });
});

describe("updateNextScheduledDate", () => {
  const context = () =>
    new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
    });

  beforeEach(seed);

  it("moves the pointer without touching the landing stamp, and only from a current read", async () => {
    const feature = await getFeature(context(), FLAG);
    if (!feature) throw new Error("seed missing");
    const at = new Date(Date.now() + 3600_000);

    await updateNextScheduledDate(feature, at);
    const doc = await features().findOne({ organization: ORG_ID, id: FLAG });
    expect(doc?.nextScheduledUpdate).toEqual(at);
    expect(doc?.dateUpdated).toEqual(feature.dateUpdated);

    // A landing moved the stamp meanwhile; the stale pointer must not win.
    await features().updateOne(
      { organization: ORG_ID, id: FLAG },
      { $set: { dateUpdated: new Date(), nextScheduledUpdate: null } },
    );
    const unchanged = await updateNextScheduledDate(feature, new Date());
    expect(unchanged).toBe(feature);
    const after = await features().findOne({ organization: ORG_ID, id: FLAG });
    expect(after?.nextScheduledUpdate).toBeNull();
  });
});
