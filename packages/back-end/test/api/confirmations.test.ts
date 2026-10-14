import request from "supertest";
import mongoose from "mongoose";
import type { NextFunction, Request, Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyInterface } from "shared/types/apikey";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import { CONFIRM_MODEL_BY_TAG } from "shared/validators";
import type { decideConfirmation as Decide } from "back-end/src/services/confirmationDecisions";
import { ReqContextClass } from "back-end/src/services/context";
import { findAuditByEntity } from "back-end/src/models/AuditModel";
import { setupApp } from "./api.setup";

// A held REST write runs only after its person confirms it in the app.

const ORG_ID = "org_confirmations";
const FLAG = "flag";
const members = {
  u_torres: "admin",
  u_admin: "admin",
  u_viewer: "readonly",
  u_engineer: "engineer",
  u_dev: "engineer",
};
const org = {
  id: ORG_ID,
  name: "Confirmations",
  ownerEmail: "owner@test.com",
  url: "",
  dateCreated: new Date(),
  members: Object.entries(members).map(([id, role]) => ({
    id,
    role,
    // Can publish only in dev.
    environments: id === "u_dev" ? ["dev"] : [],
    limitAccessByEnvironment: id === "u_dev",
    projectRoles: [],
  })),
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "production", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const now = new Date();
const keyDoc = (id: string, extra: Partial<ApiKeyInterface>) =>
  ({
    id,
    organization: ORG_ID,
    key: `secret_${id}`,
    secret: true,
    description: id,
    limitAccessByEnvironment: false,
    environments: [],
    dateCreated: now,
    dateUpdated: now,
    ...extra,
  }) as ApiKeyInterface;
const pat = keyDoc("key_pat", {
  userId: "u_torres",
  confirmRules: [
    { actions: ["feature.publish"], environments: ["production"] },
  ],
});
const engineerPat = keyDoc("key_engineer", { userId: "u_engineer" });
const bot = keyDoc("key_bot", {
  role: "admin",
  confirmRules: [{ actions: ["feature.*"] }],
});
const ci = keyDoc("key_ci", { role: "admin" });
const assumer = keyDoc("key_assume", {
  role: "admin",
  requesterPermissions: "assume",
  confirmRules: [{ actions: ["feature.*"] }],
});

function asKey(
  key: ApiKeyInterface,
  settings: Partial<OrganizationInterface["settings"]> = {},
  // A member named with X-GrowthBook-Requested-By, as the middleware records one.
  requestedBy?: { id: string; name: string; email: string },
) {
  const context = new ReqContextClass({
    org: { ...org, settings: { ...org.settings, ...settings } },
    auditUser: key.userId
      ? { type: "api_key", apiKey: key.id, id: key.userId, name: key.userId }
      : {
          type: "api_key",
          apiKey: key.id || "",
          name: key.description || "",
          ...(requestedBy && {
            requestedBy,
            assumedRole: key.requesterPermissions === "assume",
          }),
        },
    ...(key.userId
      ? { user: { id: key.userId, email: `${key.userId}@test.com` } }
      : { role: key.role }),
    apiKey: key.id,
    apiKeyData: key,
    teams: [],
  });
  context.hasPremiumFeature = () => true;
  return context;
}

const reviews = {
  requireReviews: [
    {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: [],
      projects: [],
    },
  ],
};
const everything = { confirmRules: [{ actions: ["*"] }] };

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

async function seed(env: string) {
  await mongoose.connection.collection("organizations").insertOne({ ...org });
  await mongoose.connection.collection("users").insertMany(
    Object.keys(members).map((id) => ({
      id,
      email: `${id}@test.com`,
      name: id,
    })),
  );
  await mongoose.connection
    .collection("apikeys")
    .insertMany([pat, engineerPat, bot, ci, assumer]);
  await mongoose.connection.collection("features").insertOne({
    id: FLAG,
    organization: ORG_ID,
    owner: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    rules: [],
    environmentSettings: {
      dev: { enabled: true },
      production: { enabled: true },
    },
    dateCreated: now,
    dateUpdated: now,
  });
  const rule = {
    id: "fr_on",
    type: "force",
    description: "",
    value: "true",
    enabled: true,
    allEnvironments: false,
    environments: [env],
  };
  const revision = (version: number, status: string, rules: object[]) => ({
    organization: ORG_ID,
    featureId: FLAG,
    version,
    baseVersion: version - 1,
    status,
    defaultValue: "false",
    rules,
    environmentsEnabled: { dev: true, production: true },
    dateCreated: now,
    dateUpdated: now,
    ...(status === "published" ? { datePublished: now } : {}),
  });
  await mongoose.connection
    .collection("featurerevisions")
    .insertMany([revision(1, "published", []), revision(2, "draft", [rule])]);
}

const featureVersion = async () =>
  (
    await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: FLAG })
  )?.version;

describe("confirmations", () => {
  const { app, isReady, setReqContext } = setupApp();
  const auth = (req: request.Test) => req.set("Authorization", "Bearer foo");
  const publish = () =>
    auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/2/publish`),
    ).send({});
  const poll = (id: string) =>
    auth(request(app).get(`/api/v1/confirmations/${id}`));

  // Loaded after the harness mocks auth; importing it up front would pull in
  // the API router with the real middleware.
  let decideConfirmation: typeof Decide;

  beforeAll(async () => {
    await isReady;
    ({ decideConfirmation } = await import(
      "back-end/src/services/confirmationDecisions"
    ));
    // Production builds the context from the real request; give the harness's
    // prebuilt context that request too.
    const mocked = jest.requireMock<{ default: jest.Mock }>(
      "back-end/src/middleware/authenticateApiRequestMiddleware",
    ).default;
    const inner = mocked.getMockImplementation();
    mocked.mockImplementation(
      (
        req: Request & { context: ReqContextClass },
        res: Response,
        next: NextFunction,
      ) =>
        inner?.(req, res, () => {
          req.context.req = req;
          next();
        }),
    );
  });

  it("holds a personal token's production publish until its person confirms", async () => {
    await seed("production");
    setReqContext(asKey(pat));

    const held = await publish();
    expect(held.status).toBe(202);
    expect(held.headers.location).toBe(
      `/api/v1/confirmations/${held.body.confirmation.id}`,
    );
    expect(held.body.confirmation).toMatchObject({
      status: "pending",
      actions: [{ action: "feature.publish", environments: ["production"] }],
      summary: `Publish revision 2 of ${FLAG}`,
    });
    expect(await featureVersion()).toBe(1);

    const id = held.body.confirmation.id;
    expect((await publish()).body.confirmation.id).toBe(id);
    expect((await poll(id)).body.confirmation.status).toBe("pending");

    await expect(
      decideConfirmation(asUser("u_admin"), id, "confirm"),
    ).rejects.toThrow();
    const done = await decideConfirmation(
      asUser("u_torres"),
      id,
      "confirm",
      "Ship it",
    );
    expect(done).toMatchObject({
      status: "completed",
      response: { status: 200 },
      note: "Ship it",
    });
    expect(await featureVersion()).toBe(2);
    expect(await findAuditByEntity(ORG_ID, "apiKey", "key_pat")).toContainEqual(
      expect.objectContaining({
        event: "apiKey.confirm",
        user: expect.objectContaining({ id: "u_torres" }),
      }),
    );
    expect((await poll(id)).body.confirmation.status).toBe("completed");
  });

  it("doesn't hold a publish outside the rule's environments", async () => {
    await seed("dev");
    setReqContext(asKey(pat));
    expect((await publish()).status).toBe(200);
    expect(await featureVersion()).toBe(2);
  });

  it("expires the hold when the draft changes before confirming", async () => {
    await seed("production");
    setReqContext(asKey(pat));
    const id = (await publish()).body.confirmation.id;
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: FLAG, version: 2 },
        { $set: { dateUpdated: new Date(Date.now() + 1000) } },
      );

    const done = await decideConfirmation(asUser("u_torres"), id, "confirm");
    expect(done.status).toBe("expired");
    expect(await featureVersion()).toBe(1);
  });

  it("returns a rejection and its note to the agent", async () => {
    await seed("production");
    setReqContext(asKey(pat));
    const id = (await publish()).body.confirmation.id;

    await decideConfirmation(asUser("u_torres"), id, "reject", "Not yet");
    expect((await poll(id)).body.confirmation).toMatchObject({
      status: "rejected",
      note: "Not yet",
    });
    expect(await featureVersion()).toBe(1);
    expect(await findAuditByEntity(ORG_ID, "apiKey", "key_pat")).toContainEqual(
      expect.objectContaining({
        event: "apiKey.reject",
        user: expect.objectContaining({ id: "u_torres" }),
      }),
    );
  });

  it("lets any member allowed to publish decide for a key that names no one, once", async () => {
    await seed("dev");
    setReqContext(asKey(bot));
    const id = (await publish()).body.confirmation.id;

    await expect(
      decideConfirmation(asUser("u_viewer"), id, "confirm"),
    ).rejects.toThrow();
    const done = await decideConfirmation(asUser("u_admin"), id, "confirm");
    expect(done.status).toBe("completed");
    await expect(
      decideConfirmation(asUser("u_torres"), id, "reject"),
    ).rejects.toThrow("already decided");
    expect(await featureVersion()).toBe(2);
  });

  it("holds a toggle, then applies it once confirmed", async () => {
    await seed("production");
    setReqContext(asKey(pat));
    const enabled = async () =>
      (
        await mongoose.connection
          .collection("features")
          .findOne({ organization: ORG_ID, id: FLAG })
      )?.environmentSettings?.production?.enabled;

    const held = await auth(
      request(app).post(`/api/v1/features/${FLAG}/toggle`),
    ).send({ environments: { production: false } });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.summary).toBe(
      `Update ${FLAG}: turn off in production`,
    );
    expect(await enabled()).toBe(true);

    const done = await decideConfirmation(
      asUser("u_torres"),
      held.body.confirmation.id,
      "confirm",
    );
    expect(done.response?.status).toBe(200);
    expect(await enabled()).toBe(false);
  });

  it("holds a toggle that steps over a required review", async () => {
    await seed("production");
    setReqContext(
      asKey({ ...pat, confirmRules: [{ actions: ["override.*"] }] }, reviews),
    );
    const held = await auth(
      request(app).post(`/api/v1/features/${FLAG}/toggle`),
    ).send({ environments: { production: false } });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "override.bypassApproval", environments: ["production"] },
    ]);
  });

  it("asks a key's decider to be allowed everywhere a hold can't place", async () => {
    await seed("production");
    setReqContext(asKey({ ...bot, ...everything }));
    const held = await auth(
      request(app).post(
        `/api/v2/features/${FLAG}/revisions/2/schedule-publish`,
      ),
    ).send({
      scheduledPublishAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(held.body.confirmation.actions).toEqual([
      { action: "feature.publish", environments: [] },
    ]);

    await expect(
      decideConfirmation(asUser("u_dev"), held.body.confirmation.id, "confirm"),
    ).rejects.toThrow(/permission/i);
    const done = await decideConfirmation(
      asUser("u_engineer"),
      held.body.confirmation.id,
      "confirm",
    );
    expect(done.status).toBe("completed");
  });

  it("holds arming a publish as the publish itself", async () => {
    await seed("production");
    setReqContext(asKey(pat));
    const held = await auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/2/request-review`),
    ).send({ autoPublishOnApproval: true });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "feature.publish", environments: [] },
    ]);
  });

  it("runs an armed publish unheld when it fires, confirmed when it was armed", async () => {
    const { maybeAutoPublishFeatureRevision } = await import(
      "back-end/src/api/features/autoPublishOnApproval"
    );
    await seed("production");
    const feature = await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: FLAG });
    const revision = {
      ...(await mongoose.connection
        .collection("featurerevisions")
        .findOne({ organization: ORG_ID, featureId: FLAG, version: 2 })),
      status: "approved",
      autoPublishOnApproval: true,
      autoPublishEnabledBy: "u_torres",
    } as unknown as FeatureRevisionInterface;

    // Approved by a key whose own publishes would hold.
    await maybeAutoPublishFeatureRevision(
      asKey(pat),
      feature as unknown as FeatureInterface,
      revision,
    );
    expect(await featureVersion()).toBe(2);
  });

  it("declares what every write to a live model may hold for", async () => {
    const { allRoutes } = await import("back-end/src/api/api.router");
    const undeclared = allRoutes
      .filter(
        (route) =>
          route.method &&
          route.method !== "get" &&
          route.tags?.some((tag) => tag in CONFIRM_MODEL_BY_TAG) &&
          route.confirmation === undefined,
      )
      .map((route) => `${route.method.toUpperCase()} ${route.path}`);
    expect(undeclared).toEqual([]);
  });

  it("asks about a direct update only once its checks pass", async () => {
    await seed("production");
    const archive = () =>
      auth(request(app).post(`/api/v2/features/${FLAG}`)).send({
        archived: true,
      });

    setReqContext(asKey({ ...engineerPat, ...everything }, reviews));
    const refused = await archive();
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/requires approval/);

    setReqContext(asKey({ ...pat, ...everything }, reviews));
    const held = await archive();
    expect(held.status).toBe(202);
    expect(held.body.confirmation).toMatchObject({
      summary: `Archive ${FLAG}`,
      actions: [
        { action: "feature.publish" },
        { action: "feature.archive" },
        { action: "override.bypassApproval" },
      ],
    });
  });

  it("holds a request that asks to skip a check, even on a draft", async () => {
    await seed("production");
    setReqContext(
      asKey({ ...pat, confirmRules: [{ actions: ["override.*"] }] }),
    );
    const createDraft = (query: string) =>
      auth(
        request(app).post(`/api/v2/features/${FLAG}/revisions${query}`),
      ).send({});

    const held = await createDraft("?overrideDraftLimit=true");
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "override.draftLimit", environments: [] },
    ]);
    expect((await createDraft("")).status).toBe(200);
  });

  it("holds a skip flag on a direct update, where the handler holds", async () => {
    await seed("production");
    setReqContext(
      asKey({ ...pat, confirmRules: [{ actions: ["override.*"] }] }),
    );
    const held = await auth(
      request(app).post(`/api/v2/features/${FLAG}?skipSchemaValidation=true`),
    ).send({ archived: true });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "override.skipSchemaValidation", environments: [] },
    ]);
  });

  it("shows the checks a publish skips, in their own words", async () => {
    await seed("production");
    setReqContext(asKey({ ...pat, ...everything }, reviews));
    const held = await publish();
    expect(held.status).toBe(202);
    expect(
      await mongoose.connection
        .collection("confirmations")
        .findOne({ id: held.body.confirmation.id }),
    ).toMatchObject({
      notices: [
        {
          severity: "error",
          messages: expect.arrayContaining([expect.stringMatching(/approv/i)]),
          via: "bypassApprovalPermission",
        },
      ],
      lastAttemptAt: null,
    });
  });

  it("holds a saved group archive after its checks, with what it skips", async () => {
    await seed("production");
    await mongoose.connection.collection("savedgroups").insertMany(
      ["grp_beta", "grp_parent"].map((id) => ({
        id,
        organization: ORG_ID,
        groupName: id,
        owner: "",
        type: "condition",
        condition:
          id === "grp_parent"
            ? '{"$savedGroups": ["grp_beta"]}'
            : '{"id": {"$in": ["a"]}}',
        dateCreated: now,
        dateUpdated: now,
      })),
    );
    setReqContext(asKey({ ...pat, ...everything }));

    const held = await auth(
      request(app).post("/api/v1/saved-groups/grp_beta/archive"),
    ).send({ ignoreWarnings: true });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "savedGroup.archive", environments: [] },
      { action: "override.ignoreWarnings", environments: [] },
    ]);
    expect(
      await mongoose.connection
        .collection("confirmations")
        .findOne({ id: held.body.confirmation.id }),
    ).toMatchObject({
      notices: [{ severity: "warning", via: "ignoreWarnings" }],
    });
  });

  it("shows what refused the agent's last try when the retry skips it", async () => {
    await seed("production");
    setReqContext(
      asKey(
        { ...pat, confirmRules: [{ actions: ["override.*"] }] },
        { maxConcurrentDrafts: 1 },
      ),
    );
    const createDraft = (query: string) =>
      auth(
        request(app).post(`/api/v2/features/${FLAG}/revisions${query}`),
      ).send({});

    const refused = await createDraft("");
    expect(refused.status).toBe(409);
    const held = await createDraft("?overrideDraftLimit=true");
    expect(held.status).toBe(202);
    expect(
      await mongoose.connection
        .collection("confirmations")
        .findOne({ id: held.body.confirmation.id }),
    ).toMatchObject({
      notices: [
        { severity: "error", messages: [refused.body.message], via: null },
      ],
      lastAttemptAt: expect.any(Date),
    });
  });

  it("lets only the member an org key assumes confirm, and replays as them", async () => {
    await seed("production");
    const engineer = {
      id: "u_engineer",
      name: "u_engineer",
      email: "u_engineer@test.com",
    };
    setReqContext(asKey(assumer, {}, engineer));

    const held = await publish();
    expect(held.status).toBe(202);
    const id = held.body.confirmation.id;
    await expect(
      decideConfirmation(asUser("u_admin"), id, "confirm"),
    ).rejects.toThrow();

    const done = await decideConfirmation(asUser("u_engineer"), id, "confirm");
    expect(done.status).toBe("completed");
    expect(done.response?.status).toBe(200);
    const revision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: FLAG, version: 2 });
    expect(revision?.publishedBy).toMatchObject({
      apiKey: "key_assume",
      requestedBy: { id: "u_engineer" },
      assumedRole: true,
    });
  });

  it("leaves an org key without rules alone", async () => {
    await seed("production");
    setReqContext(asKey(ci));
    expect((await publish()).status).toBe(200);
  });
});
