import request from "supertest";
import mongoose from "mongoose";
import type { Job } from "agenda";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { updateSingleExperimentStatus } from "back-end/src/jobs/updateExperimentStatus";
import { setupApp } from "./api.setup";

// A staged start or stop fires on the authority of whoever staged it, checked
// at fire time. This drives the real REST routes, Mongo document, and job.

const ORG_ID = "org_sched";
const EXP_ID = "exp_sched";
const FEATURE_ID = "feat_sched";
const HOUR = 60 * 60 * 1000;

const users = {
  u_owner: "admin",
  u_exp: "experimenter",
  u_collab: "collaborator",
};
const org = {
  id: ORG_ID,
  name: "Scheduling",
  ownerEmail: "owner@test.com",
  url: "",
  dateCreated: new Date(),
  members: Object.entries(users).map(([id, role]) => ({
    id,
    role,
    environments: [],
    limitAccessByEnvironment: false,
    projectRoles: [],
  })),
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

const experiments = () => mongoose.connection.collection("experiments");
const organizations = () => mongoose.connection.collection("organizations");
const audits = () => mongoose.connection.collection("audits");
const job = {
  attrs: { data: { experimentId: EXP_ID, organization: ORG_ID } },
} as unknown as Job<{ experimentId: string; organization: string }>;

function asUser(id: string) {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "dashboard", id, email: `${id}@test.com`, name: id },
    user: { id, email: `${id}@test.com`, name: id },
    teams: [],
  });
  context.hasPremiumFeature = () => true;
  return context;
}

async function seed(status: "draft" | "running") {
  await organizations().insertOne({ ...org });
  await mongoose.connection.collection("users").insertMany(
    Object.keys(users).map((id) => ({
      id,
      email: `${id}@test.com`,
      name: id,
    })),
  );
  // The rule is live in production, so starting or stopping the experiment
  // needs run permission there.
  await mongoose.connection.collection("features").insertOne({
    id: FEATURE_ID,
    organization: ORG_ID,
    owner: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    environmentSettings: {
      production: {
        enabled: true,
        rules: [
          {
            type: "experiment-ref",
            id: "fr_sched",
            description: "",
            experimentId: EXP_ID,
            enabled: true,
            variations: [
              { variationId: "0", value: "false" },
              { variationId: "1", value: "true" },
            ],
          },
        ],
      },
    },
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  await experiments().insertOne({
    id: EXP_ID,
    organization: ORG_ID,
    trackingKey: EXP_ID,
    name: "Scheduled",
    type: "standard",
    owner: "u_owner",
    project: "",
    hypothesis: "",
    description: "",
    tags: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    archived: false,
    status,
    autoSnapshots: false,
    hashAttribute: "id",
    hashVersion: 2,
    variations: [
      { id: "0", key: "0", name: "Control", screenshots: [] },
      { id: "1", key: "1", name: "Variation", screenshots: [] },
    ],
    phases: [
      {
        dateStarted: new Date(Date.now() - HOUR),
        name: "Main",
        reason: "",
        coverage: 1,
        condition: "",
        savedGroups: [],
        namespace: { enabled: false, name: "", range: [0, 1] },
        variationWeights: [0.5, 0.5],
      },
    ],
    linkedFeatures: [FEATURE_ID],
    datasource: "",
    exposureQueryId: "",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    decisionFrameworkSettings: {},
    implementation: "code",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    ideaSource: "",
    releasedVariationId: "",
  });
}

const staged = async () =>
  (await experiments().findOne({ id: EXP_ID }))?.nextScheduledStatusUpdate;
const status = async () =>
  (await experiments().findOne({ id: EXP_ID }))?.status;
const fireNow = () =>
  experiments().updateOne(
    { id: EXP_ID },
    { $set: { "nextScheduledStatusUpdate.date": new Date(Date.now() - 1000) } },
  );
const lastStatusAudit = () =>
  audits().findOne(
    { event: "experiment.status" },
    { sort: { dateCreated: -1 } },
  );

describe("scheduled status changes run as the user who staged them", () => {
  const { app, setReqContext } = setupApp();
  const auth = (req: request.Test) => req.set("Authorization", "Bearer foo");
  const schedule = { startAt: new Date(Date.now() + HOUR) };
  const stopPlan = {
    stopAt: new Date(Date.now() + 2 * HOUR),
    scheduledStopPlan: { mode: "stop" },
  };

  async function stageStartAs(userId: string) {
    setReqContext(asUser(userId));
    const scheduled = await auth(
      request(app)
        .put(`/api/v1/experiments/${EXP_ID}/schedule`)
        .send({ ...schedule, ...stopPlan }),
    );
    expect(scheduled.status).toBe(200);
    const approved = await auth(
      request(app)
        .post(`/api/v1/experiments/${EXP_ID}/start`)
        .send({ skipChecklist: true }),
    );
    expect(approved.status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledBy: userId,
    });
  }

  it("starts and later stops as the scheduler, not the owner", async () => {
    await seed("draft");
    await stageStartAs("u_exp");

    await fireNow();
    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("running");
    expect((await lastStatusAudit())?.user).toMatchObject({ id: "u_exp" });
    // The stop staged by the start carries the same authority.
    expect(await staged()).toMatchObject({
      type: "stop",
      scheduledBy: "u_exp",
    });

    await fireNow();
    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("stopped");
    expect(await staged()).toBeNull();
    expect((await lastStatusAudit())?.user).toMatchObject({ id: "u_exp" });
  });

  it("gives up when the scheduler has since lost run permission", async () => {
    await seed("draft");
    await stageStartAs("u_exp");
    await organizations().updateOne(
      { id: ORG_ID, "members.id": "u_exp" },
      { $set: { "members.$.role": "collaborator" } },
    );

    await fireNow();
    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("draft");
    expect(await staged()).toBeNull();
  });

  it("keeps retrying while the scheduler cannot be resolved", async () => {
    await seed("draft");
    await stageStartAs("u_exp");
    await organizations().updateOne(
      { id: ORG_ID },
      { $pull: { members: { id: "u_exp" } } },
    );

    await fireNow();
    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("draft");
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledBy: "u_exp",
      failedAttempts: 1,
    });
  });

  it.each([
    ["admin", "running"],
    ["collaborator", "draft"],
  ])(
    "runs an unstamped pointer as the owner (owner role %s → %s)",
    async (ownerRole, expected) => {
      await seed("draft");
      await organizations().updateOne(
        { id: ORG_ID, "members.id": "u_owner" },
        { $set: { "members.$.role": ownerRole } },
      );
      await experiments().updateOne(
        { id: EXP_ID },
        {
          $set: {
            statusUpdateSchedule: schedule,
            nextScheduledStatusUpdate: {
              type: "start",
              date: new Date(Date.now() - 1000),
            },
          },
        },
      );

      await updateSingleExperimentStatus(job);

      expect(await status()).toBe(expected);
      if (expected === "running") {
        expect((await lastStatusAudit())?.user).toMatchObject({
          id: "u_owner",
        });
      }
    },
  );

  it("stamps a stop scheduled on a running experiment through either REST route", async () => {
    await seed("running");
    setReqContext(asUser("u_exp"));

    const viaSchedule = await auth(
      request(app).put(`/api/v1/experiments/${EXP_ID}/schedule`).send(stopPlan),
    );
    expect(viaSchedule.status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "stop",
      scheduledBy: "u_exp",
    });

    setReqContext(asUser("u_owner"));
    const viaUpdate = await auth(
      request(app)
        .post(`/api/v1/experiments/${EXP_ID}`)
        .send({
          statusUpdateSchedule: {
            ...stopPlan,
            stopAt: new Date(Date.now() + 3 * HOUR),
          },
        }),
    );
    expect(viaUpdate.status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "stop",
      scheduledBy: "u_owner",
    });
  });
});
