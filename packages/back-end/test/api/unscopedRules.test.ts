import mongoose from "mongoose";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ContextualBanditInterface } from "shared/validators";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

const ORG_ID = "org_unscoped_rules";
const FLAG = "checkout";
const BANDIT_FLAG = "checkout-layout";
const RULES_FLAG = "checkout-copy";
const now = new Date("2026-01-01");

const contextualBandit: ContextualBanditInterface = {
  id: "cb_unscoped_rules",
  organization: ORG_ID,
  dateCreated: now,
  dateUpdated: now,
  name: "Checkout layout",
  description: "",
  project: "",
  owner: "",
  tags: [],
  archived: false,
  status: "running",
  trackingKey: "checkout-layout",
  hashAttribute: "id",
  variations: [
    { id: "v0", key: "0", name: "Control", screenshots: [] },
    { id: "v1", key: "1", name: "Treatment", screenshots: [] },
  ],
  datasource: "",
  contextualBanditQueryId: "",
  coverage: 1,
  seed: "checkout-layout",
  variationWeights: [
    { variationId: "v0", weight: 0.5 },
    { variationId: "v1", weight: 0.5 },
  ],
  currentLeafWeights: [],
  banditVersion: 0,
  contextualAttributes: [],
  minUsersPerLeaf: 100,
  maxLeaves: 12,
  holdoutPercent: 0,
  banditModelVersion: 1,
};

const variations = [
  { variationId: "v0", value: "false" },
  { variationId: "v1", value: "true" },
];
const banditRule = {
  id: "fr_cb",
  type: "contextual-bandit-ref",
  contextualBanditId: contextualBandit.id,
  description: "",
  enabled: true,
  condition: "",
  scheduleRules: [],
  allEnvironments: false,
  environments: ["production"],
  variations,
};

const forceRule = {
  type: "force",
  description: "",
  value: "true",
  enabled: true,
};

const { app, isReady, setReqContext } = setupApp();

// Production builds the context from the real request, where the override
// flag lives; give the harness's prebuilt context that request too.
beforeAll(async () => {
  await isReady;
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

function asAdmin(requireScopedFeatureRules: boolean) {
  const context = new ReqContextClass({
    org: {
      id: ORG_ID,
      name: "Unscoped rules",
      ownerEmail: "owner@example.com",
      url: "",
      dateCreated: now,
      members: [],
      settings: {
        environments: [
          { id: "dev", description: "" },
          { id: "production", description: "" },
        ],
        requireScopedFeatureRules,
      },
    } as unknown as OrganizationInterface,
    auditUser: { type: "api_key", apiKey: "key_admin" },
    role: "admin",
    apiKey: "key_admin",
  });
  context.hasPremiumFeature = () => true;
  setReqContext(context);
}

const flagDocs = (id: string, rules: object[]) => [
  {
    collection: "features",
    doc: {
      id,
      organization: ORG_ID,
      owner: "",
      valueType: "boolean",
      defaultValue: "false",
      version: 1,
      rules,
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: true },
      },
      dateCreated: now,
      dateUpdated: now,
    },
  },
  {
    collection: "featurerevisions",
    doc: {
      organization: ORG_ID,
      featureId: id,
      version: 1,
      baseVersion: 0,
      status: "published",
      defaultValue: "false",
      rules,
      environmentsEnabled: { dev: true, production: true },
      dateCreated: now,
      dateUpdated: now,
      datePublished: now,
    },
  },
];

beforeEach(async () => {
  const db = mongoose.connection.db!;
  await db
    .collection("contextualbandits")
    .insertOne(structuredClone(contextualBandit));
  for (const { collection, doc } of [
    ...flagDocs(FLAG, []),
    ...flagDocs(BANDIT_FLAG, [banditRule]),
    ...flagDocs(RULES_FLAG, [
      {
        ...forceRule,
        id: "fr_dev",
        allEnvironments: false,
        environments: ["dev"],
      },
      { ...forceRule, id: "fr_all", allEnvironments: true },
    ]),
  ]) {
    await db.collection(collection).insertOne(structuredClone(doc));
  }
});

afterEach(async () => {
  const db = mongoose.connection.db!;
  await Promise.all(
    ["contextualbandits", "features", "featurerevisions"].map((name) =>
      db.collection(name).deleteMany({}),
    ),
  );
});

describe("POST /api/v2/features/:id", () => {
  const update = (body: object) =>
    request(app)
      .post(`/api/v2/features/${FLAG}`)
      .set("Authorization", "Bearer key_admin")
      .send(body);
  const everywhere = { rules: [{ type: "force", value: "true" }] };

  it("refuses a new rule for all environments and projects until allowed", async () => {
    asAdmin(true);
    const refused = await update(everywhere);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("unscoped_rule");
    expect(
      (await update({ ...everywhere, allowUnscopedRules: true })).status,
    ).toBe(200);
  });

  it("accepts a rule that targets specific environments", async () => {
    asAdmin(true);
    const response = await update({
      rules: [{ type: "force", value: "true", environments: ["dev"] }],
    });
    expect(response.status).toBe(200);
  });

  it("changes nothing when the setting is off", async () => {
    asAdmin(false);
    expect((await update(everywhere)).status).toBe(200);
  });
});

describe("PUT /api/v1/contextual-bandits/:id/linked-feature/:featureId", () => {
  const replace = (body: object) =>
    request(app)
      .put(
        `/api/v1/contextual-bandits/${contextualBandit.id}/linked-feature/${BANDIT_FLAG}`,
      )
      .set("Authorization", "Bearer key_admin")
      .send({ variations, ...body });

  it("refuses widening the rule to every environment until allowed", async () => {
    asAdmin(true);
    const refused = await replace({});
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: "unscoped_rule",
      details: { ruleIds: ["fr_cb"] },
    });
    expect((await replace({ allowUnscopedRules: true })).status).toBe(200);
  });

  it("accepts keeping the rule's environments", async () => {
    asAdmin(true);
    const response = await replace({ environments: ["production"] });
    expect(response.status).toBe(200);
  });
});

describe("PUT /api/v2/features/:id/revisions/:version/rules/:ruleId", () => {
  const patchRule = (ruleId: string, body: object) =>
    request(app)
      .put(`/api/v2/features/${RULES_FLAG}/revisions/new/rules/${ruleId}`)
      .set("Authorization", "Bearer key_admin")
      .send(body);

  it("refuses widening a rule to every environment until allowed", async () => {
    asAdmin(true);
    const widen = { rule: { allEnvironments: true } };
    const refused = await patchRule("fr_dev", widen);
    expect(refused.status).toBe(422);
    expect(refused.body.details).toEqual({ ruleIds: ["fr_dev"] });
    expect(
      (await patchRule("fr_dev", { ...widen, allowUnscopedRules: true }))
        .status,
    ).toBe(200);
  });

  it("keeps a rule that already applies everywhere editable", async () => {
    asAdmin(true);
    const response = await patchRule("fr_all", {
      rule: { description: "Holiday copy" },
    });
    expect(response.status).toBe(200);
  });
});
