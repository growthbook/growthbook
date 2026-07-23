import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { createInitialRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  createAndPublishRevision,
  getFeature,
  prevalidatePublishImmediate,
} from "back-end/src/models/FeatureModel";
import { setupApp } from "../api.setup";

// Regression tests for the two publish-immediately custom-hook bugs:
//  Bug 1 — validateFeatureRevision was handed the stored (pre-change) feature,
//          so a hook inspecting feature.tags never observed a tag edit and could
//          not block it.
//  Bug 2 — on publish-immediately the draft revision was written before the
//          validateFeature hook ran, so a hook rejection orphaned the draft.
// Both are exercised through createAndPublishRevision (the REST publish-
// immediately path) plus a direct check of prevalidatePublishImmediate (the
// dashboard autoPublish path's up-front validation helper).

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

async function seedHook(hook: "validateFeature" | "validateFeatureRevision") {
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

  // Bug 1: a validateFeatureRevision hook that reads feature.tags must observe
  // the staged tag removal and block the publish. Pre-fix the hook received the
  // stored feature (tags still present) and silently passed.
  it("blocks a tag-removal publish when a validateFeatureRevision hook requires the tag", async () => {
    const { context, feature } = await setup(["important"]);
    await seedHook("validateFeatureRevision");

    // Reject only when the feature under validation lost the "important" tag.
    mockRunInSandbox.mockImplementation(async (_code, args) => {
      const f = (args as { feature?: { tags?: string[] } }).feature;
      if (!f?.tags?.includes("important")) {
        return { ok: false, error: "Must have 'important' tag", warnings: [] };
      }
      return { ok: true, warnings: [] };
    });

    await expect(
      createAndPublishRevision({
        context,
        feature,
        user: context.auditUser,
        org: ORG,
        changes: { metadata: { tags: [] } },
        comment: "remove tag",
        canBypassApprovalChecks: true,
      }),
    ).rejects.toThrow("Must have 'important' tag");

    // The revision hook was handed the proposed (merged) feature, i.e. tags
    // already removed — proving Bug 1's fix.
    expect(
      (mockRunInSandbox.mock.calls[0][1] as { feature: { tags: string[] } })
        .feature.tags,
    ).toEqual([]);

    // No new revision was published and the live feature keeps its tag.
    expect(await countRevisions()).toBe(1);
    expect((await findRevision(2)) ?? null).toBeNull();
    expect((await getFeature(context, FEATURE_ID))?.tags).toEqual([
      "important",
    ]);
  });

  // Bug 2: a validateFeature hook that rejects on publish-immediately must fail
  // BEFORE the draft revision is written, leaving no orphan draft.
  it("does not persist a draft revision when a validateFeature hook rejects the publish", async () => {
    const { context, feature } = await setup(["important"]);
    await seedHook("validateFeature");

    // The feature hook receives { feature } (no revision); reject it.
    mockRunInSandbox.mockImplementation(async (_code, args) => {
      if (!("revision" in (args as Record<string, unknown>))) {
        return { ok: false, error: "feature hook rejected", warnings: [] };
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
    ).rejects.toThrow("feature hook rejected");

    // Only the initial published revision exists — the draft was never written.
    expect(await countRevisions()).toBe(1);
    expect((await findRevision(2)) ?? null).toBeNull();
  });

  // Dashboard autoPublish path helper: prevalidatePublishImmediate runs the
  // hooks against the merged feature and throws WITHOUT writing anything.
  it("prevalidatePublishImmediate validates the merged feature and never writes", async () => {
    const { context, feature } = await setup(["important"]);
    await seedHook("validateFeatureRevision");

    mockRunInSandbox.mockImplementation(async (_code, args) => {
      const f = (args as { feature?: { tags?: string[] } }).feature;
      if (!f?.tags?.includes("important")) {
        return { ok: false, error: "Must have 'important' tag", warnings: [] };
      }
      return { ok: true, warnings: [] };
    });

    await expect(
      prevalidatePublishImmediate({
        context,
        feature,
        changes: { metadata: { tags: [] } },
        result: { metadata: { tags: [] } },
        comment: "remove tag",
      }),
    ).rejects.toThrow("Must have 'important' tag");

    // Saw the merged feature (tag removed) and wrote nothing.
    expect(
      (mockRunInSandbox.mock.calls[0][1] as { feature: { tags: string[] } })
        .feature.tags,
    ).toEqual([]);
    expect(await countRevisions()).toBe(1);
  });
});
