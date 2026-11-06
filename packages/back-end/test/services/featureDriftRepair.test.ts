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
// The feature document an older ramp left behind: the keys it cleared were
// written as nulls, while its live revision omits them.
const driftedRule = {
  ...liveRule,
  condition: null,
  savedGroups: null,
  prerequisites: null,
};

describe("repairFeatureDriftIfNeeded", () => {
  setupApp();

  it("restores the live revision even when a validateFeature hook rejects it", async () => {
    const now = new Date();
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
      status: "published",
      comment: "Ramp complete",
      defaultValue: "false",
      rules: [liveRule],
      dateCreated: now,
      dateUpdated: now,
      datePublished: now,
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
    mockRunInSandbox.mockResolvedValue({
      ok: false,
      error: "Rule fr_ramped is fully rolled out",
      warnings: [],
    });

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

    const stored = await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: "flag" });
    expect(stored?.rules).toEqual([liveRule]);
    expect(mockRunInSandbox).not.toHaveBeenCalled();
  });
});
