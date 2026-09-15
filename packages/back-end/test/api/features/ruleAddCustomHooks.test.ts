import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import {
  createInitialRevision,
  createRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getFeature } from "back-end/src/models/FeatureModel";
import { setupApp } from "../api.setup";

// Regression tests: a custom-hook rejection on the rule-add endpoint must not orphan a SafeRollout doc

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));

// Field validation needs a real datasource + metrics; return a canned valid shape instead
jest.mock("back-end/src/validators/safe-rollout", () => ({
  validateCreateSafeRolloutFields: jest.fn(async () => ({
    datasourceId: "ds_1",
    exposureQueryId: "q_1",
    guardrailMetricIds: ["met_1"],
    maxDuration: { amount: 3, unit: "days" },
    autoRollback: false,
  })),
}));

const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;

const ORG = {
  id: "org_hooks_test",
  name: "Hooks Test",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [
      { id: "production", description: "" },
      { id: "dev", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const FEATURE_ID = "feat_hooks_test";

function makeContext(query: Record<string, string> = {}) {
  return new ReqContextClass({
    org: ORG,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    // context.ignoreWarnings reads req.query
    req: { query, headers: {} } as unknown as Request,
  });
}

async function seedFeature() {
  await mongoose.connection.collection("features").insertOne({
    id: FEATURE_ID,
    organization: ORG.id,
    version: 1,
    defaultValue: "false",
    valueType: "boolean",
    owner: "",
    description: "",
    project: "",
    tags: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    rules: [],
    environmentSettings: {
      production: { enabled: true },
      dev: { enabled: false },
    },
    archived: false,
  });
}

async function seedDraftRevision(context: ReqContextClass) {
  const feature = await getFeature(context, FEATURE_ID);
  if (!feature) throw new Error("seed feature missing");
  // createRevision requires a published base revision for feature.version.
  await createInitialRevision(context, feature, context.auditUser, [
    "production",
    "dev",
  ]);
  return createRevision({
    context,
    feature,
    user: context.auditUser,
    baseVersion: feature.version,
    environments: ["production", "dev"],
    publish: false,
    changes: {},
    org: ORG,
    canBypassApprovalChecks: false,
  });
}

async function seedRevisionHook() {
  await mongoose.connection.collection("customhooks").insertOne({
    id: "hook_test_1",
    organization: ORG.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: true,
    projects: [],
    name: "test revision hook",
    hook: "validateFeatureRevision",
    code: "// behavior comes from the runInSandbox mock",
  });
}

const SAFE_ROLLOUT_RULE_BODY = {
  environment: "production",
  rule: {
    type: "safe-rollout",
    controlValue: "false",
    variationValue: "true",
    hashAttribute: "id",
    safeRolloutFields: {
      datasourceId: "ds_1",
      exposureQueryId: "q_1",
      guardrailMetricIds: ["met_1"],
      maxDuration: { amount: 3, unit: "days" },
    },
  },
};

describe("rule-add custom hook prevalidation", () => {
  const { app, setReqContext } = setupApp();

  let premiumSpy: jest.SpyInstance;

  beforeEach(() => {
    premiumSpy = jest
      .spyOn(ReqContextClass.prototype, "hasPremiumFeature")
      .mockReturnValue(true);
    mockRunInSandbox.mockResolvedValue({ ok: true, warnings: [] });
  });

  afterEach(() => {
    premiumSpy.mockRestore();
  });

  async function setup() {
    const context = makeContext();
    setReqContext(context);
    await seedFeature();
    const revision = await seedDraftRevision(context);
    await seedRevisionHook();
    return { context, revision };
  }

  it("does not create a safeRollout doc when a hook rejects the revision", async () => {
    const { revision } = await setup();
    mockRunInSandbox.mockResolvedValue({
      ok: false,
      error: "Rejected by hook",
      warnings: [],
    });

    const response = await request(app)
      .post(
        `/api/v1/features/${FEATURE_ID}/revisions/${revision.version}/rules`,
      )
      .set("Authorization", "Bearer foo")
      .send(SAFE_ROLLOUT_RULE_BODY);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Rejected by hook");

    // No orphaned safeRollout doc
    expect(
      await mongoose.connection.collection("saferollout").countDocuments(),
    ).toBe(0);

    // Revision untouched
    const revisionDoc = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: FEATURE_ID, version: revision.version });
    expect(revisionDoc?.rules ?? []).toHaveLength(0);
  });

  it("does not create a safeRollout doc on an unacknowledged soft warning, and creates exactly one on the ignoreWarnings retry", async () => {
    const { revision } = await setup();
    mockRunInSandbox.mockResolvedValue({
      ok: true,
      warnings: ["check this"],
    });

    const warned = await request(app)
      .post(
        `/api/v1/features/${FEATURE_ID}/revisions/${revision.version}/rules`,
      )
      .set("Authorization", "Bearer foo")
      .send(SAFE_ROLLOUT_RULE_BODY);

    expect(warned.status).toBe(422);
    expect(warned.body.warnings).toEqual(["check this"]);
    expect(
      await mongoose.connection.collection("saferollout").countDocuments(),
    ).toBe(0);

    // Pre-fix, the ignoreWarnings retry produced a second safeRollout doc; now exactly one
    setReqContext(makeContext({ ignoreWarnings: "true" }));
    const retried = await request(app)
      .post(
        `/api/v1/features/${FEATURE_ID}/revisions/${revision.version}/rules?ignoreWarnings=true`,
      )
      .set("Authorization", "Bearer foo")
      .send(SAFE_ROLLOUT_RULE_BODY);

    expect(retried.status).toBe(200);
    expect(
      await mongoose.connection.collection("saferollout").countDocuments(),
    ).toBe(1);
  });

  it("double-fires hooks on a successful save (prevalidate + authoritative)", async () => {
    const { revision } = await setup();
    mockRunInSandbox.mockResolvedValue({ ok: true, warnings: [] });

    const response = await request(app)
      .post(
        `/api/v1/features/${FEATURE_ID}/revisions/${revision.version}/rules`,
      )
      .set("Authorization", "Bearer foo")
      .send(SAFE_ROLLOUT_RULE_BODY);

    expect(response.status).toBe(200);
    // One from prevalidateRevisionUpdate, one from updateRevision
    expect(mockRunInSandbox).toHaveBeenCalledTimes(2);
    expect(
      await mongoose.connection.collection("saferollout").countDocuments(),
    ).toBe(1);

    const revisionDoc = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: FEATURE_ID, version: revision.version });
    expect(revisionDoc?.rules).toHaveLength(1);
    expect(revisionDoc?.rules[0].type).toBe("safe-rollout");
  });
});
