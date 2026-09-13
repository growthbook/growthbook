import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// Deleting a flag that something still gates on as a prerequisite would leave
// that dependent pointing at nothing, and the payload builder then drops it
// silently. Both live features and experiments block the delete.

const ORG_ID = "org_delete_deps";
const org = {
  id: ORG_ID,
  name: "Delete Deps",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

const now = () => new Date();

async function insertFeature(
  id: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await mongoose.connection.collection("features").insertOne({
    id,
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
    ...extra,
  });
}

async function insertExperiment(
  id: string,
  prerequisites: { id: string; condition: string }[],
): Promise<void> {
  await mongoose.connection.collection("experiments").insertOne({
    id,
    organization: ORG_ID,
    project: "",
    trackingKey: id,
    name: id,
    type: "standard",
    status: "running",
    archived: false,
    variations: [],
    phases: [{ name: "Main", dateStarted: now(), prerequisites }],
    dateCreated: now(),
    dateUpdated: now(),
  });
}

describe("deleting a flag other things gate on", () => {
  const { app, setReqContext } = setupApp();
  const PARENT = "parent_flag";
  const del = () =>
    request(app)
      .delete(`/api/v2/features/${PARENT}`)
      .set("Authorization", "Bearer foo");

  beforeEach(async () => {
    setReqContext(
      new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key_admin" },
        role: "admin",
        req: { query: {}, headers: {}, body: {} } as unknown as Request,
      }),
    );
    await insertFeature(PARENT, { archived: true });
  });

  it("is blocked by a live feature prerequisite", async () => {
    await insertFeature("child_flag", {
      prerequisites: [{ id: PARENT, condition: '{"value": true}' }],
    });
    const res = await del();
    expect(res.body.message).toMatch(/1 live Feature Flag/);
    expect(res.status).toBe(400);
  });

  it("is blocked by an experiment phase prerequisite", async () => {
    await insertExperiment("exp_gated", [
      { id: PARENT, condition: '{"value": true}' },
    ]);
    const res = await del();
    expect(res.body.message).toMatch(/1 Experiment/);
    expect(res.status).toBe(400);
  });

  it("proceeds once nothing depends on it", async () => {
    await insertFeature("unrelated");
    await insertExperiment("exp_free", []);
    const res = await del();
    expect(res.body.message).toBeUndefined();
    expect(res.status).toBe(200);
  });
});
