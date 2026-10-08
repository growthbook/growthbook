import request from "supertest";
import mongoose from "mongoose";
import type { Job } from "agenda";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyInterface } from "shared/types/apikey";
import { ReqContextClass } from "back-end/src/services/context";
import { updateSingleExperimentStatus } from "back-end/src/jobs/updateExperimentStatus";
import { approveScheduledExperimentStart } from "back-end/src/services/experimentChanges/changeExperimentStatus";
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

// An org key: experimenter everywhere, but only a collaborator in the flag's project.
function asKey(id: string, projectRoles: ApiKeyInterface["projectRoles"] = []) {
  const apiKeyData = {
    id,
    role: "experimenter",
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles,
  } as unknown as ApiKeyInterface;
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: id, name: "CI" },
    role: "experimenter",
    apiKey: id,
    apiKeyData,
    teams: [],
  });
  context.hasPremiumFeature = () => true;
  return context;
}

// A draft on a flag in its own project, published when the experiment starts.
async function seedPendingDraft() {
  const now = new Date();
  const rule = {
    type: "experiment-ref",
    id: "fr_draft",
    experimentId: EXP_ID,
    enabled: true,
    allEnvironments: true,
    variations: [
      { variationId: "0", value: "false" },
      { variationId: "1", value: "true" },
    ],
  };
  await mongoose.connection.collection("features").insertOne({
    id: "feat_draft",
    organization: ORG_ID,
    project: "proj_flag",
    owner: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    environmentSettings: { production: { enabled: true, rules: [] } },
    dateCreated: now,
    dateUpdated: now,
  });
  const revision = (version: number, rules: object[]) => ({
    id: `frev_feat_draft_${version}`,
    organization: ORG_ID,
    featureId: "feat_draft",
    version,
    baseVersion: 1,
    status: version === 1 ? "published" : "draft",
    createdBy: { type: "api_key", apiKey: "key_ci" },
    comment: "",
    defaultValue: "false",
    rules,
    dateCreated: now,
    dateUpdated: now,
    ...(version === 1 ? { datePublished: now } : {}),
  });
  await mongoose.connection
    .collection("featurerevisions")
    .insertMany([revision(1, []), revision(2, [rule])]);
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

function asUser(id: string, orgDoc: OrganizationInterface = org) {
  const context = new ReqContextClass({
    org: orgDoc,
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
  (await experiments().findOne({ id: EXP_ID }))?.nextScheduledStatusUpdate ??
  null;
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

describe("a scheduled status change is checked when armed and fires as the armer", () => {
  const { app, setReqContext } = setupApp();
  const auth = (req: request.Test) => req.set("Authorization", "Bearer foo");
  const schedule = { startAt: new Date(Date.now() + HOUR) };
  const stopPlan = {
    stopAt: new Date(Date.now() + 2 * HOUR),
    scheduledStopPlan: { mode: "stop" },
  };
  const keyDoc = (role: string) => ({
    id: "key_ci",
    organization: ORG_ID,
    key: "secret_ci",
    secret: true,
    description: "CI",
    role,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  async function armStart(context: ReqContextClass) {
    setReqContext(context);
    const scheduled = await auth(
      request(app)
        .put(`/api/v1/experiments/${EXP_ID}/schedule`)
        .send({ ...schedule, ...stopPlan }),
    );
    expect(scheduled.status).toBe(200);
    return auth(
      request(app)
        .post(`/api/v1/experiments/${EXP_ID}/start`)
        .send({ skipChecklist: true }),
    );
  }

  it("fires a user's start and the stop it derives as that user, never the owner", async () => {
    await seed("draft");
    expect((await armStart(asUser("u_exp"))).status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledBy: "u_exp",
    });

    await fireNow();
    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("running");
    expect((await lastStatusAudit())?.user).toMatchObject({ id: "u_exp" });
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

  it("gives up when the armer has since lost run permission", async () => {
    await seed("draft");
    expect((await armStart(asUser("u_exp"))).status).toBe(200);
    await organizations().updateOne(
      { id: ORG_ID, "members.id": "u_exp" },
      { $set: { "members.$.role": "collaborator" } },
    );

    await fireNow();
    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("draft");
    expect(await staged()).toBeNull();
  });

  it.each([
    ["scheduled", true],
    ["immediate", false],
  ])(
    "refuses a %s start by a key that may run the experiment but not publish its pending draft",
    async (_kind, viaSchedule) => {
      await seed("draft");
      await seedPendingDraft();
      const key = asKey("key_ci", [
        { project: "proj_flag", role: "collaborator" },
      ]);
      let res;
      if (viaSchedule) {
        res = await armStart(key);
      } else {
        setReqContext(key);
        res = await auth(
          request(app)
            .post(`/api/v1/experiments/${EXP_ID}/start`)
            .send({ skipChecklist: true }),
        );
      }
      expect(res.status).toBe(403);
      expect(await status()).toBe("draft");
      expect(await staged()).toBeNull();
    },
  );

  it("refuses to arm a key that cannot even read the flag a pending draft is on", async () => {
    await seed("draft");
    await seedPendingDraft();
    const res = await armStart(
      asKey("key_ci", [{ project: "proj_flag", role: "noaccess" }]),
    );
    expect(res.status).toBe(403);
    expect(await staged()).toBeNull();
  });

  it("arms a key that may do both, and fires as the key", async () => {
    await seed("draft");
    await seedPendingDraft();
    await mongoose.connection
      .collection("apikeys")
      .insertOne(keyDoc("experimenter"));
    expect((await armStart(asKey("key_ci"))).status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledByApiKey: "key_ci",
    });

    await fireNow();
    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("running");
    expect((await lastStatusAudit())?.user).toMatchObject({
      apiKey: "key_ci",
      name: "CI",
    });
    expect(await staged()).toMatchObject({
      type: "stop",
      scheduledByApiKey: "key_ci",
    });

    await fireNow();
    await updateSingleExperimentStatus(job);

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
    const pat = {
      ...keyDoc("experimenter"),
      id: "key_pat",
      key: "secret_pat",
      userId: "u_owner",
      scoped: true,
      limitAccessByEnvironment: false,
      environments: [],
    };
    await mongoose.connection.collection("apikeys").insertOne({ ...pat });
    const armed = await armStart(
      asScopedPat(pat as unknown as ApiKeyInterface),
    );
    expect(armed.status).toBe(200);
    expect(await staged()).toMatchObject({
      type: "start",
      scheduledByApiKey: "key_pat",
    });

    await fireNow();
    await updateSingleExperimentStatus(job);

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
    await fireNow();
    await updateSingleExperimentStatus(job);

    expect(await status()).toBe("running");
    expect(await staged()).toBeNull();
  });

  it("gives up when the key that armed a start has since been narrowed", async () => {
    await seed("draft");
    await seedPendingDraft();
    await mongoose.connection
      .collection("apikeys")
      .insertOne(keyDoc("collaborator"));
    expect((await armStart(asKey("key_ci"))).status).toBe(200);

    await fireNow();
    await updateSingleExperimentStatus(job);

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
