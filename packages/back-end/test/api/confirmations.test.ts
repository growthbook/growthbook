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
import { setupApp } from "./api.setup";

// A held REST write runs only after its person confirms it in the app.

const ORG_ID = "org_confirmations";
const FLAG = "flag";
const members = {
  u_torres: "admin",
  u_admin: "admin",
  u_viewer: "readonly",
  u_engineer: "engineer",
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
    environments: [],
    limitAccessByEnvironment: false,
    projectRoles: [],
  })),
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "production", description: "" },
    ],
    confirmRules: [
      { actions: ["feature.publish"], environments: ["production"] },
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
const pat = keyDoc("key_pat", { userId: "u_torres" });
const engineerPat = keyDoc("key_engineer", { userId: "u_engineer" });
const bot = keyDoc("key_bot", {
  role: "admin",
  confirmRules: [{ actions: ["feature.*"] }],
});
const ci = keyDoc("key_ci", { role: "admin" });

function asKey(
  key: ApiKeyInterface,
  settings: Partial<OrganizationInterface["settings"]> = {},
) {
  const context = new ReqContextClass({
    org: { ...org, settings: { ...org.settings, ...settings } },
    auditUser: key.userId
      ? { type: "api_key", apiKey: key.id, id: key.userId, name: key.userId }
      : { type: "api_key", apiKey: key.id || "", name: key.description || "" },
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
    .insertMany([pat, engineerPat, bot, ci]);
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
    const done = await decideConfirmation(asUser("u_torres"), id, "confirm");
    expect(done).toMatchObject({
      status: "completed",
      response: { status: 200 },
    });
    expect(await featureVersion()).toBe(2);
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
      rejectionNote: "Not yet",
    });
    expect(await featureVersion()).toBe(1);
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

  it("holds a route-level action before its handler runs", async () => {
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
      "Toggle a feature in one or more environments",
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

  it("leaves an approved draft for a confirmable publish instead of auto-publishing it", async () => {
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
    } as unknown as FeatureRevisionInterface;

    expect(
      await maybeAutoPublishFeatureRevision(
        asKey(pat),
        feature as unknown as FeatureInterface,
        revision,
      ),
    ).toBe(revision);
    expect(await featureVersion()).toBe(1);
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

  it("leaves an org key without rules alone", async () => {
    await seed("production");
    setReqContext(asKey(ci));
    expect((await publish()).status).toBe(200);
  });
});
