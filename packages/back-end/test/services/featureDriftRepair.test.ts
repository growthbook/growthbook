import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { repairFeatureDriftIfNeeded } from "back-end/src/services/featureDriftRepair";
import { setupApp } from "../api/api.setup";

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));
const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;

const ORG_ID = "org_feature_drift_repair";
const ENVS = ["production", "dev"];
const org = {
  id: ORG_ID,
  name: "Feature Drift Repair",
  ownerEmail: "o@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: ENVS.map((id) => ({ id, description: "" })) },
} as unknown as OrganizationInterface;

const liveRule = {
  type: "rollout",
  id: "fr_ramped",
  description: "",
  value: "true",
  coverage: 1,
  hashAttribute: "id",
  seed: "flag",
  enabled: true,
  allEnvironments: true,
};
const driftedRule = {
  ...liveRule,
  condition: null,
  savedGroups: null,
  prerequisites: null,
};

const storedRules = async () =>
  (
    await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: "flag" })
  )?.rules;

async function seed(liveStatus: string) {
  const now = new Date();
  for (const c of ["features", "featurerevisions", "customhooks"]) {
    await mongoose.connection
      .collection(c)
      .deleteMany({ organization: ORG_ID });
  }
  await mongoose.connection.collection("features").insertOne({
    id: "flag",
    organization: ORG_ID,
    owner: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 2,
    rules: [driftedRule],
    environmentSettings: {
      production: { enabled: true },
      dev: { enabled: true },
    },
    dateCreated: now,
    dateUpdated: now,
  });
  await mongoose.connection.collection("featurerevisions").insertOne({
    organization: ORG_ID,
    featureId: "flag",
    version: 2,
    baseVersion: 1,
    status: liveStatus,
    comment: "",
    defaultValue: "false",
    rules: [liveRule],
    dateCreated: now,
    dateUpdated: now,
  });
  await mongoose.connection.collection("customhooks").insertOne({
    id: "hook_validateFeature",
    organization: ORG_ID,
    dateCreated: now,
    dateUpdated: now,
    enabled: true,
    projects: [],
    name: "validateFeature",
    hook: "validateFeature",
    code: "// mocked",
    incrementalChangesOnly: false,
  });
}

async function repair() {
  const ctx = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_admin" },
    role: "admin",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  ctx.hasPremiumFeature = () => true;
  const feature = (await getFeature(ctx, "flag"))!;
  const live = await getRevision({
    context: ctx,
    organization: ORG_ID,
    featureId: "flag",
    feature,
    version: feature.version,
  });
  await repairFeatureDriftIfNeeded(ctx, feature, live ?? undefined, ENVS, {
    throwOnFailure: true,
  });
}

describe("repairFeatureDriftIfNeeded with a rejecting validateFeature hook", () => {
  setupApp();

  beforeEach(() => {
    mockRunInSandbox.mockReset();
    mockRunInSandbox.mockResolvedValue({
      ok: false,
      error: "Rule fr_ramped is fully rolled out",
      warnings: [],
    });
  });

  it("restores a published live revision without consulting hooks", async () => {
    await seed("published");
    await repair();
    expect(await storedRules()).toEqual([liveRule]);
    expect(mockRunInSandbox).not.toHaveBeenCalled();
  });

  it("lets hooks judge a live revision that is not published yet", async () => {
    await seed("draft");
    await expect(repair()).rejects.toThrow(
      "Could not reconcile feature with its live revision: ",
    );
    expect(await storedRules()).toEqual([driftedRule]);
    expect(mockRunInSandbox).toHaveBeenCalled();
  });
});
