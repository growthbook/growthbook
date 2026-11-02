import { setTimeout as delay } from "timers/promises";
import request from "supertest";
import mongoose from "mongoose";
import type { NextFunction, Request, Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyInterface } from "shared/types/apikey";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
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
const recommended = keyDoc("key_recommended", {
  role: "admin",
  confirmRules: [{ actions: ["recommended"] }],
});
const assumer = keyDoc("key_assume", {
  role: "admin",
  actAs: "user",
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
            assumedRole: key.actAs === "user",
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
  // Written through the driver, so the harness doesn't clear them between tests.
  await mongoose.connection.collection("confirmations").deleteMany({});
  await mongoose.connection.collection("confirmationattempts").deleteMany({});
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
    .insertMany([pat, engineerPat, bot, ci, assumer, recommended]);
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

const EXP = "exp_hitl";
// A draft experiment the flag's draft is queued on, published when it starts.
const seedExperiment = () =>
  mongoose.connection.collection("experiments").insertOne({
    id: EXP,
    organization: ORG_ID,
    trackingKey: EXP,
    name: "Checkout test",
    type: "standard",
    owner: "u_admin",
    project: "",
    hypothesis: "",
    description: "",
    tags: [],
    dateCreated: now,
    dateUpdated: now,
    archived: false,
    status: "draft",
    autoSnapshots: false,
    hashAttribute: "id",
    hashVersion: 2,
    variations: [
      { id: "0", key: "0", name: "Control", screenshots: [] },
      { id: "1", key: "1", name: "Variation", screenshots: [] },
    ],
    phases: [
      {
        dateStarted: now,
        name: "Main",
        reason: "",
        coverage: 1,
        condition: "",
        savedGroups: [],
        namespace: { enabled: false, name: "", range: [0, 1] },
        variationWeights: [0.5, 0.5],
      },
    ],
    linkedFeatures: [FLAG],
    pendingFeatureDrafts: [{ featureId: FLAG, revisionVersion: 2 }],
    datasource: "",
    exposureQueryId: "",
    goalMetrics: [],
    secondaryMetrics: [],
  });

const insertConstant = (key: string) =>
  mongoose.connection.collection("constants").insertOne({
    id: `const_${key}`,
    organization: ORG_ID,
    key,
    name: key,
    owner: "",
    type: "string",
    value: "before",
    dateCreated: now,
    dateUpdated: now,
  });

const insertBandit = (id: string, status: "draft" | "running") =>
  mongoose.connection.collection("contextualbandits").insertOne({
    id,
    organization: ORG_ID,
    dateCreated: now,
    dateUpdated: now,
    name: id,
    description: "",
    project: "",
    owner: "",
    tags: [],
    archived: false,
    status,
    trackingKey: id,
    hashAttribute: "id",
    variations: [
      { id: "v0", key: "0", name: "Control", screenshots: [] },
      { id: "v1", key: "1", name: "Treatment", screenshots: [] },
    ],
    datasource: "",
    contextualBanditQueryId: "",
    coverage: 1,
    seed: id,
    variationWeights: [
      { variationId: "v0", weight: 0.5 },
      { variationId: "v1", weight: 0.5 },
    ],
    currentLeafWeights: [],
    banditVersion: 0,
    contextualAttributes: ["country"],
    minUsersPerLeaf: 100,
    maxLeaves: 12,
    holdoutPercent: 0,
    banditModelVersion: 1,
  });

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
    expect(held.headers["retry-after"]).toBe("5");
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
    ).rejects.toThrow(/permission/i);
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
    expect(done).toMatchObject({
      status: "expired",
      response: {
        status: 400,
        body: { message: expect.stringContaining("changed after it was") },
      },
    });
    expect(await featureVersion()).toBe(1);
  });

  it("runs nothing once a hold has expired or its key is gone", async () => {
    await seed("production");
    setReqContext(asKey(pat));
    const expired = (await publish()).body.confirmation.id;
    await mongoose.connection
      .collection("confirmations")
      .updateOne({ id: expired }, { $set: { expiresAt: new Date(0) } });
    expect((await poll(expired)).body.confirmation.status).toBe("expired");
    await expect(
      decideConfirmation(asUser("u_torres"), expired, "confirm"),
    ).rejects.toThrow(/already decided or has expired/);

    const orphaned = (await publish()).body.confirmation.id;
    expect(orphaned).not.toBe(expired);
    await mongoose.connection.collection("apikeys").deleteOne({ id: pat.id });
    await expect(
      decideConfirmation(asUser("u_torres"), orphaned, "confirm"),
    ).rejects.toThrow(/key that made this request is gone/);
    expect((await poll(orphaned)).body.confirmation.status).toBe("expired");
    expect(await featureVersion()).toBe(1);
  });

  // A held OAuth request whose token lapses before anyone confirms it.
  const holdFromOAuth = async (clientId: string) => {
    await seed("production");
    await mongoose.connection.collection("oauthgrants").insertOne({
      id: `oag_${clientId}`,
      organization: ORG_ID,
      clientId,
      userId: "u_torres",
      permissions: { confirmRules: pat.confirmRules },
      revoked: false,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      dateCreated: now,
      dateUpdated: now,
    });
    const sent = keyDoc(`key_${clientId}`, {
      userId: "u_torres",
      role: "user",
      oauthClientId: clientId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      confirmRules: pat.confirmRules,
    });
    await mongoose.connection.collection("apikeys").insertOne({ ...sent });
    setReqContext(asKey(sent));
    const id = (await publish()).body.confirmation.id;
    await mongoose.connection.collection("apikeys").deleteOne({ id: sent.id });
    return id;
  };

  it("replays an OAuth sign-in's request on its grant once the token is gone", async () => {
    const id = await holdFromOAuth("client_mcp");
    expect(
      await decideConfirmation(asUser("u_torres"), id, "confirm"),
    ).toMatchObject({ status: "completed", response: { status: 200 } });
    expect(await featureVersion()).toBe(2);
  });

  it.each([
    ["has been revoked", "client_revoked", { revoked: true }],
    ["was revoked, even after signing in again", "client_back", {}],
  ])(
    "runs nothing for an OAuth sign-in that %s",
    async (_label, clientId, fields) => {
      const id = await holdFromOAuth(clientId);
      await mongoose.connection
        .collection("oauthgrants")
        .updateOne(
          { clientId },
          { $set: { revokedAt: new Date(Date.now() + 1000), ...fields } },
        );
      await expect(
        decideConfirmation(asUser("u_torres"), id, "confirm"),
      ).rejects.toThrow(/key that made this request is gone/);
      expect(await featureVersion()).toBe(1);
    },
  );

  it("reports a run a restart cut off as failed, so the agent can ask again", async () => {
    await seed("production");
    setReqContext(asKey(pat));
    const id = (await publish()).body.confirmation.id;
    await mongoose.connection
      .collection("confirmations")
      .updateOne(
        { id },
        { $set: { status: "running", decidedAt: new Date(0) } },
      );

    expect((await poll(id)).body.confirmation).toMatchObject({
      status: "completed",
      response: {
        status: 500,
        body: { message: expect.stringContaining("cut off") },
      },
    });
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

  it("lets anyone in the org decide for a key that names no one, once", async () => {
    await seed("dev");
    setReqContext(asKey(bot));
    const id = (await publish()).body.confirmation.id;

    const done = await decideConfirmation(asUser("u_viewer"), id, "confirm");
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

  it("declares what every write may hold for", async () => {
    const { allRoutes } = await import("back-end/src/api/api.router");
    const writes = allRoutes.filter(
      (route) => route.method && route.method !== "get",
    );
    const name = (route: (typeof writes)[number]) =>
      `${route.method.toUpperCase()} ${route.path}`;
    expect(
      writes.filter((route) => route.confirmation === undefined).map(name),
    ).toEqual([]);
    // Declaring nothing marks a read: only a POST that computes can be one.
    expect(
      writes
        .filter(
          (route) =>
            route.confirmation?.length === 0 && route.method !== "post",
        )
        .map(name),
    ).toEqual([]);
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

  it("refuses a draft past the cap first, then shows why when the retry skips it", async () => {
    await seed("production");
    setReqContext(
      asKey(
        { ...pat, confirmRules: [{ actions: ["feature.*", "override.*"] }] },
        { maxConcurrentDrafts: 1 },
      ),
    );
    const createDraft = (query: string) =>
      auth(
        request(app).post(`/api/v2/features/${FLAG}/revisions${query}`),
      ).send({});

    const refused = await createDraft("");
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain("?overrideDraftLimit=true");
    const held = await createDraft("?overrideDraftLimit=true");
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "feature.draft", environments: [] },
      { action: "override.draftLimit", environments: [] },
    ]);
    expect(
      await mongoose.connection
        .collection("confirmations")
        .findOne({ id: held.body.confirmation.id }),
    ).toMatchObject({
      notices: [
        {
          severity: "warning",
          messages: [
            refused.body.message.replace(
              " To create a new one anyway, resend with `?overrideDraftLimit=true`.",
              "",
            ),
          ],
          via: null,
        },
      ],
      lastAttemptAt: expect.any(Date),
    });
  });

  it("holds a rule for all environments and projects once the org requires scoped rules", async () => {
    await seed("production");
    const scoped = { requireScopedFeatureRules: true };
    setReqContext(
      asKey({ ...pat, confirmRules: [{ actions: ["override.*"] }] }, scoped),
    );
    const addRule = (body: object) =>
      auth(
        request(app).post(`/api/v2/features/${FLAG}/revisions/2/rules`),
      ).send({ rule: { type: "force", value: "true" }, ...body });

    const refused = await addRule({});
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("unscoped_rule");
    const held = await addRule({ allowUnscopedRules: true });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "override.unscopedRules", environments: [] },
    ]);
    expect(
      await mongoose.connection
        .collection("confirmations")
        .findOne({ id: held.body.confirmation.id }),
    ).toMatchObject({
      notices: [
        {
          severity: "warning",
          messages: [
            "This rule applies to All Environments and All Projects. Your organization requires rules to target specific environments or Projects.",
          ],
          via: null,
        },
      ],
    });

    // Refused before a key that holds drafts is asked to confirm one.
    setReqContext(asKey(bot, scoped));
    expect((await addRule({})).status).toBe(422);

    setReqContext(asKey(ci, scoped));
    expect((await addRule({ allowUnscopedRules: true })).status).toBe(200);
    expect(
      (
        await addRule({
          rule: { type: "force", value: "true", environments: ["dev"] },
        })
      ).status,
    ).toBe(200);
  });

  it("lets only the member a request names confirm it, assumed or not", async () => {
    await seed("production");
    setReqContext(
      asKey(
        bot,
        {},
        {
          id: "u_engineer",
          name: "u_engineer",
          email: "u_engineer@test.com",
        },
      ),
    );
    const id = (await publish()).body.confirmation.id;
    await expect(
      decideConfirmation(asUser("u_admin"), id, "confirm"),
    ).rejects.toThrow(/permission/i);
    expect(
      (await decideConfirmation(asUser("u_engineer"), id, "confirm")).status,
    ).toBe("completed");
    // Named for attribution only, they keep the credit for the change.
    const revision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: FLAG, version: 2 });
    expect(revision?.publishedBy).toMatchObject({
      apiKey: "key_bot",
      requestedBy: { id: "u_engineer" },
    });
    expect(revision?.publishedBy?.assumedRole).toBeFalsy();
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
    ).rejects.toThrow(/permission/i);

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

  it("holds approving a draft as a review, not a draft edit", async () => {
    await seed("production");
    setReqContext(asKey(bot));
    const held = await auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/2/submit-review`),
    ).send({ action: "approve" });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "feature.review", environments: [] },
    ]);
  });

  it("holds creating a flag that starts on as a publish there", async () => {
    await seed("production");
    setReqContext(asKey(recommended));
    const create = (id: string, enabled: boolean) =>
      auth(request(app).post("/api/v2/features")).send({
        id,
        owner: "owner@test.com",
        valueType: "boolean",
        defaultValue: "false",
        environments: {
          dev: { enabled: false },
          production: { enabled },
        },
      });

    expect((await create("off_everywhere", false)).status).toBe(200);
    const held = await create("on_in_production", true);
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "feature.publish", environments: ["production"] },
    ]);
  });

  it("holds an edit to a draft armed to publish as the publish", async () => {
    await seed("production");
    setReqContext(asKey(recommended));
    const toggle = (version: number | "new" = 2) =>
      auth(
        request(app).post(
          `/api/v2/features/${FLAG}/revisions/${version}/toggle`,
        ),
      ).send({ environment: "dev", enabled: false });

    expect((await toggle()).status).toBe(200);
    setReqContext(asKey({ ...bot, ...everything }));
    expect((await toggle()).body.confirmation.actions).toEqual([
      { action: "feature.draft", environments: [] },
    ]);
    setReqContext(asKey(recommended));
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: FLAG, version: 2 },
        { $set: { autoPublishOnApproval: true } },
      );
    // The edit may add anything a landing does, so it holds as all of it.
    const held = await toggle();
    expect(held.status).toBe(202);
    expect(
      held.body.confirmation.actions.map(
        ({ action }: { action: string }) => action,
      ),
    ).toEqual([
      "feature.publish",
      "feature.archive",
      "rampSchedule.start",
      "rampSchedule.edit",
    ]);
    setReqContext(
      asKey({ ...bot, confirmRules: [{ actions: ["rampSchedule.start"] }] }),
    );
    expect((await toggle()).status).toBe(202);
    // A fresh draft isn't armed, whatever else is.
    expect((await toggle("new")).status).toBe(200);
  });

  it("holds arming a draft that archives as the archive", async () => {
    await seed("production");
    setReqContext(asKey(ci));
    expect(
      (
        await auth(
          request(app).put(`/api/v2/features/${FLAG}/revisions/2/archive`),
        ).send({ archived: true })
      ).status,
    ).toBe(200);
    setReqContext(
      asKey({ ...bot, confirmRules: [{ actions: ["feature.archive"] }] }),
    );
    const held = await auth(
      request(app).post(
        `/api/v2/features/${FLAG}/revisions/2/schedule-publish`,
      ),
    ).send({
      scheduledPublishAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "feature.archive", environments: [] },
    ]);

    // A ramp plan on the draft starts when it lands, so arming it holds too.
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: FLAG, version: 2 },
        { $set: { rampActions: [{ mode: "create" }] } },
      );
    setReqContext(
      asKey({ ...bot, confirmRules: [{ actions: ["rampSchedule.start"] }] }),
    );
    const ramp = await auth(
      request(app).post(
        `/api/v2/features/${FLAG}/revisions/2/schedule-publish`,
      ),
    ).send({
      scheduledPublishAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(ramp.body.confirmation?.actions).toEqual([
      { action: "rampSchedule.start", environments: [] },
    ]);
  });

  it("holds a real bulk import, but not its dry run, and dryRun skips nothing else", async () => {
    await seed("production");
    setReqContext(asKey(recommended));
    const importFacts = (dryRun: boolean) =>
      auth(request(app).post("/api/v1/bulk-import/facts")).send({ dryRun });
    expect((await importFacts(true)).status).toBe(200);
    expect((await importFacts(false)).status).toBe(202);
    // Routes without a dry run ignore the flag, so it can't skip their hold.
    expect(
      (
        await auth(request(app).delete("/api/v1/environments/dev")).send({
          dryRun: true,
        })
      ).status,
    ).toBe(202);
  });

  it("refuses starting by update past its checklist unless asked, then holds naming what it skips", async () => {
    await seed("production");
    await seedExperiment();
    setReqContext(
      asKey({
        ...bot,
        confirmRules: [{ actions: ["override.skipChecklist"] }],
      }),
    );
    const refused = await auth(
      request(app).post(`/api/v1/experiments/${EXP}`),
    ).send({ status: "running" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("checklist_incomplete");
    expect(refused.body.gates).toContainEqual(
      expect.objectContaining({ key: "datasource", override: "skipChecklist" }),
    );

    const held = await auth(
      request(app).post(`/api/v1/experiments/${EXP}`),
    ).send({ status: "running", skipChecklist: true });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "override.skipChecklist", environments: [] },
    ]);
    const stored = await mongoose.connection
      .collection("confirmations")
      .findOne({ id: held.body.confirmation.id });
    expect(stored?.notices).toContainEqual({
      severity: "warning",
      messages: ["Select a Data Source"],
      via: "skipChecklist",
    });
  });

  it("holds archiving a live experiment as POST /archive does, and unarchiving as its start", async () => {
    await seed("production");
    await seedExperiment();
    const experiments = mongoose.connection.collection("experiments");
    await experiments.updateOne({ id: EXP }, { $set: { status: "running" } });
    setReqContext(
      asKey({
        ...bot,
        confirmRules: [{ actions: ["experiment.stop", "experiment.start"] }],
      }),
    );
    const archive = await auth(
      request(app).post(`/api/v1/experiments/${EXP}`),
    ).send({ archived: true });
    expect(archive.status).toBe(202);
    expect(archive.body.confirmation.actions).toEqual([
      { action: "experiment.stop", environments: [] },
    ]);

    await experiments.updateOne({ id: EXP }, { $set: { archived: true } });
    const unarchive = await auth(
      request(app).post(`/api/v1/experiments/${EXP}/unarchive`),
    ).send({});
    expect(unarchive.status).toBe(202);
    expect(unarchive.body.confirmation.actions).toEqual([
      { action: "experiment.start", environments: [] },
    ]);

    await experiments.updateOne({ id: EXP }, { $set: { archived: false } });
    // As POST /archive holds it, since keeping a rollout publishes its flags.
    setReqContext(
      asKey({ ...bot, confirmRules: [{ actions: ["feature.publish"] }] }),
    );
    const publishHeld = await auth(
      request(app).post(`/api/v1/experiments/${EXP}`),
    ).send({ archived: true });
    expect(publishHeld.status).toBe(202);
    expect(publishHeld.body.confirmation.actions).toEqual([
      { action: "feature.publish", environments: [] },
    ]);
  });

  it("holds ticking manual checklist items only for a key that opts in, naming them", async () => {
    await seed("production");
    await seedExperiment();
    const checklists = mongoose.connection.collection(
      "experimentlaunchchecklists",
    );
    await checklists.deleteMany({});
    await checklists.insertOne({
      id: "elc_1",
      organizationId: ORG_ID,
      projectId: "",
      tasks: [{ task: "Legal reviewed", completionType: "manual" }],
    });
    const tick = () =>
      auth(
        request(app).post(
          `/api/v1/experiments/${EXP}/start-checklist/manual/complete`,
        ),
      ).send({ keys: ["Legal reviewed"] });

    setReqContext(
      asKey({ ...bot, confirmRules: [{ actions: ["experiment.checklist"] }] }),
    );
    const held = await tick();
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "experiment.checklist", environments: [] },
    ]);
    expect(held.body.confirmation.summary).toContain("Legal reviewed");

    // Recommended leaves it to the key: generated items still gate a start.
    setReqContext(asKey(recommended));
    expect((await tick()).status).toBe(200);
    await checklists.deleteMany({});
  });

  it("holds unarchiving a draft with an armed start as the start it restores", async () => {
    await seed("production");
    await seedExperiment();
    await mongoose.connection.collection("experiments").updateOne(
      { id: EXP },
      {
        $set: {
          archived: true,
          nextScheduledStatusUpdate: {
            type: "start",
            date: new Date(Date.now() + 86_400_000),
          },
        },
      },
    );
    setReqContext(
      asKey({ ...bot, confirmRules: [{ actions: ["feature.publish"] }] }),
    );
    const unarchive = await auth(
      request(app).post(`/api/v1/experiments/${EXP}/unarchive`),
    ).send({});
    expect(unarchive.status).toBe(202);
    expect(unarchive.body.confirmation.actions).toEqual([
      { action: "feature.publish", environments: [] },
    ]);
  });

  it("holds every publish as skipping a review when REST bypasses reviews", async () => {
    await seed("production");
    await insertConstant("hitl_bypass");
    setReqContext(asKey(ci));
    expect((await publish()).status).toBe(200);

    setReqContext(
      asKey(
        {
          ...bot,
          confirmRules: [{ actions: ["override.restBypassesReviews"] }],
        },
        { restApiBypassesReviews: true },
      ),
    );
    const skipping = [
      { action: "override.restBypassesReviews", environments: [] },
    ];
    // Held at the route, and inside a handler that holds itself.
    const update = await auth(
      request(app).post("/api/v1/constants/hitl_bypass"),
    ).send({ value: "after" });
    expect(update.status).toBe(202);
    expect(update.body.confirmation.actions).toEqual(skipping);
    const revert = await auth(
      request(app).post(`/api/v2/features/${FLAG}/revisions/1/revert`),
    ).send({ strategy: "publish" });
    expect(revert.status).toBe(202);
    expect(revert.body.confirmation.actions).toEqual(skipping);
  });

  it("holds a bandit update by what it changes, and a draft's as draft work", async () => {
    await seed("production");
    await insertBandit("cb_live", "running");
    await insertBandit("cb_draft", "draft");
    const update = (id: string, body: Record<string, unknown>) =>
      auth(request(app).put(`/api/v1/contextual-bandits/${id}`)).send(body);

    setReqContext(
      asKey({
        ...bot,
        confirmRules: [{ actions: ["experiment.stop", "experiment.traffic"] }],
      }),
    );
    expect(
      (await update("cb_live", { status: "stopped" })).body.confirmation
        ?.actions,
    ).toEqual([{ action: "experiment.stop", environments: [] }]);
    expect(
      (await update("cb_live", { coverage: 0.5 })).body.confirmation?.actions,
    ).toEqual([{ action: "experiment.traffic", environments: [] }]);
    expect((await update("cb_live", { name: "Renamed" })).status).toBe(200);
    // Changing a live bandit's variations re-weights it.
    expect(
      (
        await auth(
          request(app).post("/api/v1/contextual-bandits/cb_live/variations"),
        ).send({ addVariations: [{ name: "Third" }] })
      ).body.confirmation?.actions,
    ).toEqual([{ action: "experiment.traffic", environments: [] }]);

    setReqContext(asKey(recommended));
    expect((await update("cb_draft", { coverage: 0.5 })).status).toBe(200);
    const held = await update("cb_live", { coverage: 0.25 });
    expect(held.status).toBe(202);

    // A newer edit to the same field voids the held one.
    await mongoose.connection
      .collection("contextualbandits")
      .updateOne({ id: "cb_live" }, { $set: { coverage: 0.75 } });
    const premium = jest
      .spyOn(ReqContextClass.prototype, "hasPremiumFeature")
      .mockReturnValue(true);
    const done = await decideConfirmation(
      asUser("u_admin"),
      held.body.confirmation.id,
      "confirm",
    );
    premium.mockRestore();
    expect(done.status).toBe("expired");
  });

  it("holds work that lands a queued or armed flag draft as what it lands", async () => {
    await seed("production");
    const { holdLinkedFeatureWrite } = await import(
      "back-end/src/api/contextual-bandits/_shared"
    );
    const { queuedDraftsHold } = await import(
      "back-end/src/services/confirmations"
    );
    const feature = (await mongoose.connection
      .collection("features")
      .findOne({ id: FLAG })) as unknown as FeatureInterface;
    // With no request to hold, a matching rule refuses instead.
    const publishOnly = asKey({
      ...bot,
      confirmRules: [{ actions: ["feature.publish"] }],
    });
    await expect(
      holdLinkedFeatureWrite(publishOnly, feature, false, 2),
    ).resolves.toBeUndefined();

    await mongoose.connection.collection("featurerevisions").updateOne(
      { organization: ORG_ID, featureId: FLAG, version: 2 },
      {
        $set: {
          autoPublishOnApproval: true,
          archived: true,
          rampActions: [{ mode: "create" }],
        },
      },
    );
    await expect(
      holdLinkedFeatureWrite(publishOnly, feature, false, 2),
    ).rejects.toThrow("only a direct API request");
    // Publishing a named draft now lands its ramp; a new link starts from live.
    const rampOnly = asKey({
      ...bot,
      confirmRules: [{ actions: ["rampSchedule.start"] }],
    });
    await expect(
      holdLinkedFeatureWrite(rampOnly, feature, true, 2),
    ).rejects.toThrow("only a direct API request");
    await expect(
      holdLinkedFeatureWrite(rampOnly, feature, true, undefined),
    ).resolves.toBeUndefined();
    expect(
      (
        await queuedDraftsHold(asKey(ci), [
          { featureId: FLAG, revisionVersion: 2 },
        ])
      ).actions.sort(),
    ).toEqual(["feature.archive", "feature.publish", "rampSchedule.start"]);
  });

  it("disarms an armed draft that a key needing confirmation edits by any path", async () => {
    await seed("production");
    await insertConstant("hitl_disarm");
    setReqContext(asKey(ci));
    const constantDraft = (
      await auth(
        request(app).put("/api/v1/constants-revisions/hitl_disarm/new/value"),
      ).send({ value: "after" })
    ).body.revision;
    const flagDraft = { organization: ORG_ID, featureId: FLAG, version: 2 };
    const arm = async () => {
      await mongoose.connection
        .collection("featurerevisions")
        .updateOne(flagDraft, { $set: { autoPublishOnApproval: true } });
      await mongoose.connection
        .collection("revisions")
        .updateOne(
          { id: constantDraft.id },
          { $set: { autoPublishOnApproval: true } },
        );
    };
    const armed = async () => [
      (
        await mongoose.connection
          .collection("featurerevisions")
          .findOne(flagDraft)
      )?.autoPublishOnApproval,
      (
        await mongoose.connection
          .collection("revisions")
          .findOne({ id: constantDraft.id })
      )?.autoPublishOnApproval,
    ];
    // A direct request reaching each draft writer, as a path that doesn't
    // classify its edit would.
    const { updateRevision, getRevision } = await import(
      "back-end/src/models/FeatureRevisionModel"
    );
    const feature = (await mongoose.connection
      .collection("features")
      .findOne({ id: FLAG })) as unknown as FeatureInterface;
    const editBoth = async (key: ApiKeyInterface, confirmationId?: string) => {
      const context = asKey(key);
      context.req = {} as Request;
      context.confirmationId = confirmationId;
      const revision = await getRevision({
        context,
        organization: ORG_ID,
        featureId: FLAG,
        feature,
        version: 2,
      });
      await updateRevision(
        context,
        feature,
        revision as FeatureRevisionInterface,
        { comment: `edited by ${key.id}` },
        { user: context.auditUser, action: "edit", subject: "", value: "" },
      );
      await context.models.revisions.updateProposedChanges(
        constantDraft.id,
        [{ op: "replace", path: "/value", value: key.id }],
        "u_admin",
        { authorizedByFlow: "test" },
      );
    };
    const publishOnly = {
      ...bot,
      confirmRules: [{ actions: ["feature.publish", "constant.publish"] }],
    };

    await arm();
    await editBoth(ci);
    expect(await armed()).toEqual([true, true]);
    await editBoth(publishOnly, "cnf_confirmed");
    expect(await armed()).toEqual([true, true]);
    await editBoth(publishOnly);
    expect(await armed()).toEqual([false, false]);
  });

  it("holds a revert as the draft or the publish its strategy makes", async () => {
    await seed("production");
    await insertConstant("hitl_revert");
    setReqContext(asKey(ci));
    const draft = await auth(
      request(app).put("/api/v1/constants-revisions/hitl_revert/new/value"),
    ).send({ value: "after" });
    expect(
      (
        await auth(
          request(app).post(
            `/api/v1/constants-revisions/hitl_revert/${draft.body.revision.version}/publish`,
          ),
        ).send({})
      ).status,
    ).toBe(200);

    setReqContext(asKey(recommended));
    const revert = (strategy: "draft" | "publish") =>
      auth(
        request(app).post("/api/v1/constants-revisions/hitl_revert/1/revert"),
      ).send({ strategy });
    expect((await revert("draft")).status).toBe(200);
    const landed = await revert("publish");
    expect(landed.status).toBe(202);
    expect(landed.body.confirmation.actions).toEqual([
      { action: "constant.publish", environments: [] },
    ]);
  });

  it("holds starting an experiment as a publish of its queued drafts, pinned to them", async () => {
    await seed("production");
    await seedExperiment();
    setReqContext(asKey(recommended));
    const held = await auth(
      request(app).post(`/api/v1/experiments/${EXP}/start`),
    ).send({ skipChecklist: true });
    expect(held.status).toBe(202);
    const { id, actions } = held.body.confirmation;
    expect(
      actions.map(({ action }: { action: string }) => action).sort(),
    ).toEqual([
      "experiment.start",
      "feature.publish",
      "override.skipChecklist",
    ]);
    expect(
      (await mongoose.connection.collection("confirmations").findOne({ id }))
        ?.links,
    ).toContainEqual(expect.objectContaining({ type: "feature", label: FLAG }));

    // The queued draft changes after the hold, so the confirmed start refuses.
    await mongoose.connection
      .collection("featurerevisions")
      .updateOne(
        { organization: ORG_ID, featureId: FLAG, version: 2 },
        { $set: { dateUpdated: new Date(Date.now() + 1000) } },
      );
    expect(
      await decideConfirmation(asUser("u_admin"), id, "confirm"),
    ).toMatchObject({
      status: "expired",
      response: {
        body: { message: expect.stringContaining("changed after it was") },
      },
    });

    // So does a changed schedule, which changes when the start happens.
    const again = await auth(
      request(app).post(`/api/v1/experiments/${EXP}/start`),
    ).send({ skipChecklist: true });
    expect(again.status).toBe(202);
    await mongoose.connection.collection("experiments").updateOne(
      { id: EXP },
      {
        $set: {
          statusUpdateSchedule: {
            startAt: new Date(Date.now() + 86_400_000),
          },
        },
      },
    );
    expect(
      (
        await decideConfirmation(
          asUser("u_admin"),
          again.body.confirmation.id,
          "confirm",
        )
      ).status,
    ).toBe("expired");
  });

  it("holds a release as a publish of each item, and lands them all once confirmed", async () => {
    await seed("production");
    await insertConstant("hitl_release");
    setReqContext(asKey(ci));
    const draft = await auth(
      request(app).put("/api/v1/constants-revisions/hitl_release/new/value"),
    ).send({ value: "after" });
    expect(draft.status).toBe(200);

    setReqContext(asKey(recommended));
    const held = await auth(
      request(app).post("/api/v1/releases/publish-revisions"),
    ).send({
      revisions: [
        { entityType: "feature", id: FLAG, version: 2 },
        {
          entityType: "constant",
          key: "hitl_release",
          version: draft.body.revision.version,
        },
      ],
    });
    expect(held.status).toBe(202);
    expect(
      held.body.confirmation.actions.map(
        ({ action }: { action: string }) => action,
      ),
    ).toEqual(expect.arrayContaining(["feature.publish", "constant.publish"]));

    // The replay builds its own context, on a plan the test org doesn't have.
    const premium = jest
      .spyOn(ReqContextClass.prototype, "hasPremiumFeature")
      .mockReturnValue(true);
    const done = await decideConfirmation(
      asUser("u_admin"),
      held.body.confirmation.id,
      "confirm",
    );
    premium.mockRestore();

    expect(done).toMatchObject({
      status: "completed",
      response: { status: 200 },
    });
    expect(await featureVersion()).toBe(2);
    expect(
      (
        await mongoose.connection
          .collection("constants")
          .findOne({ organization: ORG_ID, key: "hitl_release" })
      )?.value,
    ).toBe("after");
  });

  it("names and links what a governance edit changes", async () => {
    await seed("production");
    setReqContext(asKey(ci));
    const project = (
      await auth(request(app).post("/api/v1/projects")).send({
        name: "Checkout",
      })
    ).body.project;
    const sdk = (
      await auth(request(app).post("/api/v1/sdk-connections")).send({
        name: "Checkout web",
        language: "javascript",
        environment: "production",
      })
    ).body.sdkConnection;

    setReqContext(asKey(recommended));
    for (const [path, summary, label, page] of [
      [
        `/api/v1/projects/${project.id}`,
        "Update Project Checkout: name",
        "Checkout",
        `/project/${project.id}`,
      ],
      [
        `/api/v1/sdk-connections/${sdk.id}`,
        "Update SDK Connection Checkout web: name",
        "Checkout web",
        `/sdks/${sdk.id}`,
      ],
    ]) {
      const held = await auth(request(app).put(path)).send({
        name: "Renamed",
      });
      expect(held.status).toBe(202);
      expect(held.body.confirmation.summary).toBe(summary);
      expect(
        (
          await mongoose.connection
            .collection("confirmations")
            .findOne({ id: held.body.confirmation.id })
        )?.links,
      ).toEqual([
        expect.objectContaining({ label, url: expect.stringContaining(page) }),
      ]);
    }
  });

  it("holds a revert as a publish, or as a draft when it only stages one", async () => {
    await seed("production");
    setReqContext(asKey(ci));
    expect((await publish()).status).toBe(200);

    setReqContext(asKey({ ...bot, ...everything }));
    const revert = (strategy: "draft" | "publish") =>
      auth(
        request(app).post(`/api/v2/features/${FLAG}/revisions/1/revert`),
      ).send({ strategy });
    const staged = await revert("draft");
    expect(staged.status).toBe(202);
    expect(staged.body.confirmation.actions).toEqual([
      { action: "feature.draft", environments: [] },
    ]);
    const landed = await revert("publish");
    expect(landed.status).toBe(202);
    expect(
      landed.body.confirmation.actions.map(
        ({ action }: { action: string }) => action,
      ),
    ).toContain("feature.publish");

    expect(
      await decideConfirmation(
        asUser("u_admin"),
        staged.body.confirmation.id,
        "confirm",
      ),
    ).toMatchObject({ status: "completed", response: { status: 200 } });
    expect(await featureVersion()).toBe(2);
  });

  it("holds a constant publish that archives it as an archive", async () => {
    await seed("production");
    await insertConstant("hitl_archive");
    setReqContext(asKey(ci));
    const draft = await auth(
      request(app).put("/api/v1/constants-revisions/hitl_archive/new/archive"),
    ).send({ archived: true });
    expect(draft.status).toBe(200);

    const archiveOnly = keyDoc("key_archive", {
      role: "admin",
      confirmRules: [{ actions: ["constant.archive"] }],
    });
    await mongoose.connection.collection("apikeys").insertOne(archiveOnly);
    setReqContext(asKey(archiveOnly));
    const held = await auth(
      request(app).post(
        `/api/v1/constants-revisions/hitl_archive/${draft.body.revision.version}/publish`,
      ),
    ).send({});
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "constant.archive", environments: [] },
    ]);
  });

  it("answers a waiting poll as soon as the hold is decided", async () => {
    await seed("production");
    setReqContext(asKey(pat));
    const id = (await publish()).body.confirmation.id;
    const started = Date.now();
    const waiting = auth(
      request(app).get(`/api/v1/confirmations/${id}?wait=10`),
    ).then((res) => res.body.confirmation.status);
    // Long enough for the poll to see it pending first.
    await delay(1500);
    await decideConfirmation(asUser("u_torres"), id, "reject");
    expect(await waiting).toBe("rejected");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stops a waiting poll once its client hangs up", async () => {
    await seed("production");
    setReqContext(asKey(pat));
    const id = (await publish()).body.confirmation.id;
    const { ConfirmationModel } = await import(
      "back-end/src/models/ConfirmationModel"
    );
    const reads = jest.spyOn(ConfirmationModel.prototype, "getById");
    await expect(
      auth(request(app).get(`/api/v1/confirmations/${id}?wait=10`)).timeout(
        1500,
      ),
    ).rejects.toThrow();
    const atHangUp = reads.mock.calls.length;
    await delay(3000);
    const after = reads.mock.calls.length;
    reads.mockRestore();
    expect(after - atHangUp).toBeLessThanOrEqual(1);
  });

  it("leaves an org key without rules alone", async () => {
    await seed("production");
    setReqContext(asKey(ci));
    expect((await publish()).status).toBe(200);
  });

  it("holds an environment edit on the recommended rule, but not a new one", async () => {
    await seed("production");
    setReqContext(asKey(recommended));

    const created = await auth(request(app).post("/api/v1/environments")).send({
      id: "qa",
    });
    expect(created.status).toBe(200);

    // Express also routes a trailing slash, so the replay has to as well.
    const held = await auth(
      request(app).put("/api/v1/environments/production/"),
    ).send({ description: "Live" });
    expect(held.status).toBe(202);
    expect(held.body.confirmation.actions).toEqual([
      { action: "environment.edit", environments: [] },
    ]);
    const id = held.body.confirmation.id;
    expect(held.body.confirmation.summary).toBe(
      "Update environment production: description",
    );
    expect(
      (
        await mongoose.connection
          .collection("confirmations")
          .findOne({ id }, { projection: { links: 1 } })
      )?.links,
    ).toEqual([
      {
        type: "environment",
        label: "production",
        url: expect.stringMatching(/\/environments$/),
      },
    ]);
    // Allowed to manage only dev, yet the key does the work.
    expect(
      await decideConfirmation(asUser("u_dev"), id, "confirm"),
    ).toMatchObject({ status: "completed", response: { status: 200 } });
    const saved = await mongoose.connection
      .collection("organizations")
      .findOne({ id: ORG_ID });
    expect(
      saved?.settings.environments.find(
        (env: { id: string }) => env.id === "production",
      )?.description,
    ).toBe("Live");
  });
});
