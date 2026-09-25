import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// A manual REST publish over a pending dated schedule is a warning the caller
// acknowledges, not a silent pre-emption and not a refusal.

const ORG_ID = "org_pending_schedule";
const FLAG = "flag_scheduled";
const org = {
  id: ORG_ID,
  name: "Pending Schedule",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

const now = () => new Date();
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

async function seed() {
  await mongoose.connection.collection("features").insertOne({
    id: FLAG,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    rules: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: now(),
    dateUpdated: now(),
  });
  const base = (version: number) => ({
    id: `frev_${FLAG}_${version}`,
    organization: ORG_ID,
    featureId: FLAG,
    version,
    baseVersion: version - 1,
    createdBy: { type: "api_key", apiKey: "key_admin" },
    comment: "",
    rules: [],
    dateCreated: now(),
    dateUpdated: now(),
  });
  await mongoose.connection.collection("featurerevisions").insertMany([
    {
      ...base(1),
      status: "published",
      defaultValue: "false",
      datePublished: now(),
    },
    {
      ...base(2),
      status: "draft",
      defaultValue: "true",
      autoPublishOnApproval: true,
      scheduledPublishAt: tomorrow(),
    },
  ]);
}

describe("POST /api/v2/features/:id/revisions/:version/publish with a pending schedule", () => {
  const { app, setReqContext } = setupApp();
  const useContext = (body: Record<string, unknown> = {}) =>
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key_admin" },
        role: "admin",
        req: { query: {}, headers: {}, body } as unknown as Request,
      }),
    );
  const publish = (body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v2/features/${FLAG}/revisions/2/publish`)
      .send(body)
      .set("Authorization", "Bearer foo");
  const state = async () => {
    const feature = await mongoose.connection
      .collection("features")
      .findOne({ id: FLAG });
    const revision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: FLAG, version: 2 });
    return {
      live: feature?.version,
      status: revision?.status,
      scheduled: revision?.scheduledPublishAt ?? null,
    };
  };

  beforeEach(async () => {
    useContext();
    await seed();
  });

  it("warns, then publishes and clears the schedule once acknowledged", async () => {
    const warned = await publish({ comment: "now" });
    expect(warned.status).toBe(422);
    expect(warned.body.warnings?.[0]).toMatch(/scheduled to publish on/);
    expect(await state()).toMatchObject({ live: 1, status: "draft" });

    useContext({ ignoreWarnings: true });
    const published = await publish({ comment: "now", ignoreWarnings: true });
    expect(published.body.message).toBeUndefined();
    expect(published.status).toBe(200);
    expect(await state()).toMatchObject({
      live: 2,
      status: "published",
      scheduled: null,
    });
  });
});
