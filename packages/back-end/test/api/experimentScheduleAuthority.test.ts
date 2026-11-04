import request from "supertest";
import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyInterface } from "shared/types/apikey";
import { ReqContextClass } from "back-end/src/services/context";
import { updateSingleExperimentStatus } from "back-end/src/jobs/updateExperimentStatus";
import { approveScheduledExperimentStart } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import {
  postApproveScheduledExperimentStart,
  postExperiment,
  postExperimentPhase,
  postExperimentStatus,
} from "back-end/src/controllers/experiments";
import {
  asKey,
  asUser,
  auditContext,
  checklistRefusal,
  dashboardReq,
  EXP_ID,
  experiments,
  fire,
  HOUR,
  insertExperiment,
  insertFlag,
  job,
  keyDoc,
  org,
  ORG_ID,
  organizations,
  resSpy,
  seedOrg,
  staged,
  status,
} from "./scheduledStart.fixture";
import { setupApp } from "./api.setup";

const FEATURE_ID = "feat_sched";

const audits = () => mongoose.connection.collection("audits");

const ciKey = (projectRoles: ApiKeyInterface["projectRoles"] = []) =>
  asKey(keyDoc("key_ci", "experimenter", { description: "CI", projectRoles }));

// A draft on a flag in its own project, published when the experiment starts.
async function seedPendingDraft() {
  await insertFlag(
    "feat_draft",
    "draft",
    [
      {
        type: "experiment-ref",
        id: "fr_draft",
        experimentId: EXP_ID,
        enabled: true,
        allEnvironments: true,
        variations: [
          { variationId: "0", value: "false" },
          { variationId: "1", value: "true" },
        ],
      },
    ],
    "proj_flag",
  );
  await experiments().updateOne(
    { id: EXP_ID },
    {
      $set: {
        linkedFeatures: [FEATURE_ID, "feat_draft"],
        pendingFeatureDrafts: [{ featureId: "feat_draft", revisionVersion: 2 }],
      },
    },
  );
}

async function seed(status: "draft" | "running") {
  await seedOrg();
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
  await insertExperiment({ status, linkedFeatures: [FEATURE_ID] });
}

const lastStatusAudit = () =>
  audits().findOne(
    { event: "experiment.status" },
    { sort: { dateCreated: -1 } },
  );

const { app, setReqContext } = setupApp();
const auth = (req: request.Test) => req.set("Authorization", "Bearer foo");
const schedule = { startAt: new Date(Date.now() + HOUR) };
const stopPlan = {
  stopAt: new Date(Date.now() + 2 * HOUR),
  scheduledStopPlan: { mode: "stop" },
};

const start = () =>
  auth(
    request(app)
      .post(`/api/v1/experiments/${EXP_ID}/start`)
      .send({ skipChecklist: true }),
  );

async function armStart(context: ReqContextClass) {
  setReqContext(context);
  const scheduled = await auth(
    request(app)
      .put(`/api/v1/experiments/${EXP_ID}/schedule`)
      .send({ ...schedule, ...stopPlan }),
  );
  expect(scheduled.status).toBe(200);
  return start();
}

describe("a scheduled status change is checked when armed and fires as the armer", () => {
  it("fires a user's start and the stop it derives as that user, never the owner", async () => {
    await seed("draft");
    expect((await armStart(asUser("u_exp"))).status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledBy: "u_exp",
    });

    await fire();

    expect(await status()).toBe("running");
    expect((await lastStatusAudit())?.user).toMatchObject({ id: "u_exp" });
    expect(await staged()).toMatchObject({
      type: "stop",
      scheduledBy: "u_exp",
    });

    await fire();

    expect(await status()).toBe("stopped");
    expect(await staged()).toBeNull();
    expect((await lastStatusAudit())?.user).toMatchObject({ id: "u_exp" });
  });

  it("gives up when the armer has since lost run permission", async () => {
    await seed("draft");
    expect((await armStart(asUser("u_exp"))).status).toBe(200);
    await organizations().updateOne(
      { id: ORG_ID, "members.id": "u_exp" },
      { $set: { "members.$.role": "collaborator" } },
    );

    await fire();

    expect(await status()).toBe("draft");
    expect(await staged()).toBeNull();
  });

  it.each([
    { kind: "scheduled", viaSchedule: true },
    { kind: "immediate", viaSchedule: false },
  ])(
    "refuses a $kind start by a key that may run the experiment but not publish its pending draft",
    async ({ viaSchedule }) => {
      await seed("draft");
      await seedPendingDraft();
      const key = ciKey([{ project: "proj_flag", role: "collaborator" }]);
      setReqContext(key);
      const res = viaSchedule ? await armStart(key) : await start();
      expect(res.status).toBe(403);
      expect(await status()).toBe("draft");
      expect(await staged()).toBeNull();
    },
  );

  it("refuses to arm a key that cannot even read the flag a pending draft is on", async () => {
    await seed("draft");
    await seedPendingDraft();
    const res = await armStart(
      ciKey([{ project: "proj_flag", role: "noaccess" }]),
    );
    expect(res.status).toBe(403);
    expect(await staged()).toBeNull();
  });

  it("arms a key that may do both, and fires as the key", async () => {
    await seed("draft");
    await seedPendingDraft();
    await mongoose.connection
      .collection("apikeys")
      .insertOne(keyDoc("key_ci", "experimenter", { description: "CI" }));
    expect((await armStart(ciKey())).status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledByApiKey: "key_ci",
    });

    await fire();

    expect(await status()).toBe("running");
    expect((await lastStatusAudit())?.user).toMatchObject({
      apiKey: "key_ci",
      name: "CI",
    });
    expect(await staged()).toMatchObject({
      type: "stop",
      scheduledByApiKey: "key_ci",
    });

    await fire();

    expect(await status()).toBe("stopped");
    expect((await lastStatusAudit())?.user).toMatchObject({ apiKey: "key_ci" });
  });

  // The admin owner, capped at experimenter by their own token.
  function asScopedPat(apiKeyData: ApiKeyInterface) {
    const owner = { id: "u_owner", email: "u_owner@test.com", name: "u_owner" };
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: apiKeyData.id, ...owner },
      user: owner,
      apiKey: apiKeyData.id,
      apiKeyData,
      teams: [],
    });
    context.hasPremiumFeature = () => true;
    return context;
  }

  it("fires a scoped PAT's start as the key, and gives up once the key's cap is narrowed", async () => {
    await seed("draft");
    const pat = keyDoc("key_pat", "experimenter", {
      userId: "u_owner",
      scoped: true,
    });
    await mongoose.connection.collection("apikeys").insertOne({ ...pat });
    const armed = await armStart(asScopedPat(pat));
    expect(armed.status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledByApiKey: "key_pat",
    });

    await fire();

    expect(await status()).toBe("running");
    expect((await lastStatusAudit())?.user).toMatchObject({
      apiKey: "key_pat",
      id: "u_owner",
    });
    expect(await staged()).toMatchObject({
      type: "stop",
      scheduledByApiKey: "key_pat",
    });

    // The owner is still an admin; only the token's cap shrank.
    await mongoose.connection
      .collection("apikeys")
      .updateOne({ id: "key_pat" }, { $set: { role: "collaborator" } });
    await fire();

    expect(await status()).toBe("running");
    expect(await staged()).toBeNull();
  });

  it("gives up when the key that armed a start has since been narrowed", async () => {
    await seed("draft");
    await seedPendingDraft();
    await mongoose.connection
      .collection("apikeys")
      .insertOne(keyDoc("key_ci", "collaborator", { description: "CI" }));
    expect((await armStart(ciKey())).status).toBe(200);

    await fire();

    expect(await status()).toBe("draft");
    expect(await staged()).toBeNull();
  });

  it("stops a running experiment on a pointer nobody is recorded on as the owner", async () => {
    await seed("running");
    await experiments().updateOne(
      { id: EXP_ID },
      {
        $set: {
          statusUpdateSchedule: stopPlan,
          nextScheduledStatusUpdate: {
            type: "stop",
            date: new Date(Date.now() - 1000),
          },
        },
      },
    );

    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("stopped");
    expect(await staged()).toBeNull();
    expect((await lastStatusAudit())?.user).toMatchObject({ id: "u_owner" });
  });

  it("lets someone else arm a start whose armer can no longer publish the draft", async () => {
    await seed("draft");
    await seedPendingDraft();
    expect((await armStart(asUser("u_exp"))).status).toBe(200);
    await organizations().updateOne(
      { id: ORG_ID, "members.id": "u_exp" },
      { $set: { "members.$.role": "collaborator" } },
    );

    // The dashboard re-approves an armed start without clearing it first.
    const demotedOrg = (await organizations().findOne({
      id: ORG_ID,
    })) as unknown as OrganizationInterface;
    await approveScheduledExperimentStart({
      context: asUser("u_owner", demotedOrg),
      experimentId: EXP_ID,
      skipChecklist: true,
    });
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledBy: "u_owner",
    });
  });

  it("retries a start nobody is recorded on, rather than running as the owner", async () => {
    await seed("draft");
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

    expect(await status()).toBe("draft");
    expect(await staged()).toMatchObject({ type: "start", failedAttempts: 1 });
  });

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

// The seeded org has no SDK Connection, so its start checklist has an open soft item.
describe("dashboard starts honor the starter's acknowledgment", () => {
  type StatusReq = Parameters<typeof postExperimentStatus>[0];
  type ApproveReq = Parameters<typeof postApproveScheduledExperimentStart>[0];
  type PhaseReq = Parameters<typeof postExperimentPhase>[0];

  const refusedOnSoftItem = checklistRefusal("sdkConnection");

  it("starts only when the starter skips the open items, and records the skip", async () => {
    await seed("draft");

    await expect(
      postExperimentStatus(
        dashboardReq<StatusReq>({ status: "running" }),
        resSpy().res,
      ),
    ).rejects.toMatchObject(refusedOnSoftItem);
    expect(await status()).toBe("draft");

    const req = dashboardReq<StatusReq>({
      status: "running",
      skipChecklist: true,
    });
    const { res, captured } = resSpy();
    await postExperimentStatus(req, res);

    expect(captured.status).toBe(200);
    expect(await status()).toBe("running");
    expect(auditContext(req)).toEqual({
      skipChecklist: true,
      bypassLockdown: false,
      skippedChecklistItems: expect.arrayContaining(["sdkConnection"]),
    });
  });

  it("refuses to start a draft with no phases", async () => {
    await seed("draft");
    await experiments().updateOne({ id: EXP_ID }, { $set: { phases: [] } });

    const { res, captured } = resSpy();
    await postExperimentStatus(
      dashboardReq<StatusReq>({ status: "running", skipChecklist: true }),
      res,
    );

    expect(captured.status).toBe(400);
    expect(await status()).toBe("draft");
  });

  it("won't start a draft by adding a phase", async () => {
    await seed("draft");

    const { res, captured } = resSpy();
    await postExperimentPhase(
      dashboardReq<PhaseReq>({ coverage: 1, variationWeights: [0.5, 0.5] }),
      res,
    );

    expect(captured.status).toBe(400);
    expect(await status()).toBe("draft");
  });

  it("approves a scheduled start only when the approver skips the open items", async () => {
    await seed("draft");
    await experiments().updateOne(
      { id: EXP_ID },
      {
        $set: {
          statusUpdateSchedule: { startAt: new Date(Date.now() + HOUR) },
        },
      },
    );

    await expect(
      postApproveScheduledExperimentStart(
        dashboardReq<ApproveReq>({}),
        resSpy().res,
      ),
    ).rejects.toMatchObject(refusedOnSoftItem);
    expect(await staged()).toBeFalsy();

    const req = dashboardReq<ApproveReq>({ skipChecklist: true });
    const { res, captured } = resSpy();
    await postApproveScheduledExperimentStart(req, res);

    expect(captured.status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledBy: "u_owner",
    });
    expect(auditContext(req)).toMatchObject({ skipChecklist: true });
  });
});

describe("a scheduled start's experiment", () => {
  const armed = async () => {
    await seed("draft");
    expect((await armStart(asUser("u_owner"))).status).toBe(200);
    expect(await staged()).toMatchObject({ type: "start" });
  };
  const update = (body: object) =>
    auth(request(app).post(`/api/v1/experiments/${EXP_ID}`)).send(body);

  it("refuses a REST change to what it launches, takes one to its metadata, and stays scheduled", async () => {
    await armed();

    const refused = await update({ hashAttribute: "deviceId" });

    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/hashAttribute.*start is scheduled/);
    expect((await experiments().findOne({ id: EXP_ID }))?.hashAttribute).toBe(
      "id",
    );

    expect((await update({ description: "Why it matters" })).status).toBe(200);
    expect(await staged()).toMatchObject({ type: "start" });
  });

  it("refuses new Visual Editor changes from REST", async () => {
    await armed();

    const refused = await auth(
      request(app).post(`/api/v1/experiments/${EXP_ID}/visual-changesets`),
    ).send({
      editorUrl: "https://example.com/",
      urlPatterns: [{ type: "simple", pattern: "/", include: true }],
    });

    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/Visual Editor changes/);
  });

  it("refuses a dashboard coverage change", async () => {
    await armed();
    type UpdateReq = Parameters<typeof postExperiment>[0];

    await expect(
      postExperiment(dashboardReq<UpdateReq>({ coverage: 0.5 }), resSpy().res),
    ).rejects.toThrow(/coverage.*start is scheduled/);
    expect(
      (await experiments().findOne({ id: EXP_ID }))?.phases[0].coverage,
    ).toBe(1);
  });
});
