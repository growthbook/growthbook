import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import {
  createInitialRevision,
  createRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  createAndPublishRevision,
  getFeature,
  prevalidatePublishImmediate,
} from "back-end/src/models/FeatureModel";
import { setupApp } from "../api.setup";

// Regression tests for publish-immediately validation ordering: hooks must run
// BEFORE the draft revision is written so a rejection can't orphan the draft.

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));

const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;

const ORG = {
  id: "org_pub_hooks_test",
  name: "Publish Hooks Test",
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

const FEATURE_ID = "feat_pub_hooks_test";

function makeContext(query: Record<string, string> = {}) {
  return new ReqContextClass({
    org: ORG,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query, headers: {} } as unknown as Request,
  });
}

async function seedFeature(tags: string[]) {
  await mongoose.connection.collection("features").insertOne({
    id: FEATURE_ID,
    organization: ORG.id,
    version: 1,
    defaultValue: "false",
    valueType: "boolean",
    owner: "",
    description: "",
    project: "",
    tags,
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

async function seedHook(
  hook: "validateFeature" | "validateFeatureRevision",
  incrementalChangesOnly = false,
) {
  await mongoose.connection.collection("customhooks").insertOne({
    id: `hook_${hook}`,
    organization: ORG.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: true,
    projects: [],
    name: `test ${hook} hook`,
    hook,
    code: "// behavior comes from the runInSandbox mock",
    incrementalChangesOnly,
  });
}

function countRevisions() {
  return mongoose.connection
    .collection("featurerevisions")
    .countDocuments({ organization: ORG.id, featureId: FEATURE_ID });
}

function findRevision(version: number) {
  return mongoose.connection
    .collection("featurerevisions")
    .findOne({ organization: ORG.id, featureId: FEATURE_ID, version });
}

describe("publish-immediately custom hooks", () => {
  setupApp();

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

  async function setup(tags: string[]) {
    const context = makeContext();
    await seedFeature(tags);
    const feature = await getFeature(context, FEATURE_ID);
    if (!feature) throw new Error("seed feature missing");
    // createAndPublishRevision needs a published base revision at feature.version.
    await createInitialRevision(context, feature, context.auditUser, [
      "production",
      "dev",
    ]);
    return { context, feature };
  }

  it("prevalidates against the actual next revision version", async () => {
    const { context, feature } = await setup(["important"]);
    await createRevision({
      context,
      feature,
      user: context.auditUser,
      environments: ["production", "dev"],
      baseVersion: feature.version,
      changes: { metadata: { tags: ["important", "draft"] } },
      publish: false,
      org: ORG,
    });
    await seedHook("validateFeature");

    mockRunInSandbox.mockImplementation(async (_code, args) => {
      const hookArgs = args as {
        feature?: { version?: number };
        revision?: unknown;
      };
      if (hookArgs.revision === undefined && hookArgs.feature?.version === 3) {
        return { ok: false, error: "version 3 rejected", warnings: [] };
      }
      return { ok: true, warnings: [] };
    });

    await expect(
      createAndPublishRevision({
        context,
        feature,
        user: context.auditUser,
        org: ORG,
        changes: { metadata: { tags: ["important", "extra"] } },
        comment: "add tag",
        canBypassApprovalChecks: true,
      }),
    ).rejects.toThrow("version 3 rejected");

    expect(await countRevisions()).toBe(2);
    expect((await findRevision(3)) ?? null).toBeNull();
  });

  it("prevalidates the draft-to-published lifecycle transition", async () => {
    const { context, feature } = await setup(["important"]);
    await seedHook("validateFeatureRevision", true);

    mockRunInSandbox.mockImplementation(async (_code, args) => {
      const revision = (
        args as {
          revision?: { status?: string };
        }
      ).revision;
      if (revision?.status === "published") {
        return { ok: false, error: "published rejected", warnings: [] };
      }
      return { ok: true, warnings: [] };
    });

    await expect(
      prevalidatePublishImmediate({
        context,
        feature,
        changes: { metadata: { tags: [] } },
        comment: "remove tag",
      }),
    ).rejects.toThrow("published rejected");

    expect(await countRevisions()).toBe(1);
  });
});
