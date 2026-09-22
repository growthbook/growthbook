import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// Publishing an edit to a rule under a live ramp is refused while it runs
// (pause first). Paused, it is reconciled with the plan: a field a step sets is
// refused, anything else lands in the ramp's base state so the next step does
// not replay it away.

const ORG_ID = "org_ramp_base_state";
const FLAG = "flag_ramped";
const RULE = {
  type: "rollout",
  id: "fr_ramped",
  description: "",
  value: "true",
  coverage: 0.25,
  hashAttribute: "id",
  enabled: true,
  allEnvironments: true,
};
const CONDITION = '{"country":"US"}';
const org = {
  id: ORG_ID,
  name: "Ramp Base State",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

const now = () => new Date();

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
    rules: [RULE],
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: now(),
    dateUpdated: now(),
  });
  const revision = (version: number, rules: object[]) => ({
    id: `frev_${FLAG}_${version}`,
    organization: ORG_ID,
    featureId: FLAG,
    version,
    baseVersion: 1,
    status: version === 1 ? "published" : "draft",
    createdBy: { type: "api_key", apiKey: "key_admin" },
    comment: "",
    defaultValue: "false",
    rules,
    dateCreated: now(),
    dateUpdated: now(),
    ...(version === 1 ? { datePublished: now() } : {}),
  });
  await mongoose.connection
    .collection("featurerevisions")
    .insertMany([
      revision(1, [RULE]),
      revision(2, [{ ...RULE, condition: CONDITION }]),
      revision(3, [{ ...RULE, coverage: 0.9 }]),
    ]);
}

describe("publishing a rule edit under a running ramp schedule", () => {
  const { app, setReqContext } = setupApp();
  const auth = (req: request.Test) => req.set("Authorization", "Bearer foo");
  const schedule = () =>
    mongoose.connection.collection("rampschedules").findOne({ name: "ramp" });

  beforeEach(async () => {
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_admin" },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    context.hasPremiumFeature = () => true;
    setReqContext(context);
    await seed();
    const created = await auth(
      request(app)
        .post("/api/v1/ramp-schedules")
        .send({
          name: "ramp",
          featureId: FLAG,
          ruleId: RULE.id,
          startActions: [{ patch: { coverage: 0 } }],
          steps: [
            { interval: 3600, actions: [{ patch: { coverage: 0.25 } }] },
            { interval: 3600, actions: [{ patch: { coverage: 1 } }] },
          ],
        }),
    );
    expect(created.status).toBe(200);
    await mongoose.connection.collection("rampschedules").updateOne(
      { id: created.body.rampSchedule.id },
      {
        $set: {
          status: "running",
          currentStepIndex: 0,
          targets: created.body.rampSchedule.targets.map((t: object) => ({
            ...t,
            status: "active",
          })),
        },
      },
    );
  });
  afterEach(async () => {
    await mongoose.connection.collection("rampschedules").deleteMany({});
  });

  const publish = (version: number) =>
    auth(
      request(app)
        .post(`/api/v2/features/${FLAG}/revisions/${version}/publish`)
        .send({ comment: "edit" }),
    );
  const pause = () =>
    mongoose.connection
      .collection("rampschedules")
      .updateOne({ name: "ramp" }, { $set: { status: "paused" } });

  it("refuses any edit while the schedule runs, naming the pause route", async () => {
    const res = await publish(2);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(
      /Rule "fr_ramped" is part of the running ramp schedule/,
    );
    expect(res.body.message).toMatch(/actions\/pause/);
  });

  it("carries a targeting edit into a paused schedule's base state", async () => {
    await pause();
    const res = await publish(2);
    expect(res.body.message).toBeUndefined();
    expect(res.status).toBe(200);
    const doc = await schedule();
    expect(doc?.startActions[0].patch).toMatchObject({
      coverage: 0,
      condition: CONDITION,
    });
    expect(doc?.eventHistory.at(-1)).toMatchObject({
      type: "config-edited",
      reason: "Base state updated by publishing revision 2: condition",
    });
  });

  it("refuses an edit to a field the plan sets", async () => {
    await pause();
    const before = (await schedule())?.startActions;
    const res = await publish(3);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/coverage is set by step 1/);
    expect(res.body.message).toMatch(/rules\/fr_ramped\/ramp-schedule/);
    const feature = await mongoose.connection
      .collection("features")
      .findOne({ id: FLAG });
    expect(feature?.version).toBe(1);
    expect((await schedule())?.startActions).toEqual(before);
  });
});
