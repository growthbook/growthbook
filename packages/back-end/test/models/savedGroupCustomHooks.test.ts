import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { setupApp } from "../api/api.setup";

// Custom-hook validation for saved groups is enforced authoritatively in
// SavedGroupModel.beforeCreate / beforeUpdate — the single gate that covers
// direct writes as well as revision publishes (which funnel through
// savedGroups.update). These tests exercise that gate directly against the
// model.

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));

const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;

const ORG = {
  id: "org_sg_hooks_test",
  name: "SG Hooks Test",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

const GROUP_ID = "grp_sg_hooks_test";

function makeContext(query: Record<string, string> = {}) {
  return new ReqContextClass({
    org: ORG,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    // context.ignoreWarnings reads req.query
    req: { query, headers: {} } as unknown as Request,
  });
}

async function seedSavedGroup() {
  await mongoose.connection.collection("savedgroups").insertOne({
    id: GROUP_ID,
    organization: ORG.id,
    groupName: "Hooks test group",
    owner: "",
    type: "condition",
    condition: '{"country": "US"}',
    description: "original",
    projects: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
}

async function seedGlobalSavedGroupHook() {
  await mongoose.connection.collection("customhooks").insertOne({
    id: "hook_sg_1",
    organization: ORG.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: true,
    projects: [],
    name: "test saved group hook",
    hook: "validateSavedGroup",
    code: "// behavior comes from the runInSandbox mock",
    incrementalChangesOnly: false,
  });
}

async function seedEntityScopedHook(entityId: string) {
  await mongoose.connection.collection("customhooks").insertOne({
    id: "hook_sg_scoped",
    organization: ORG.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: true,
    projects: [],
    name: "scoped saved group hook",
    hook: "validateSavedGroup",
    code: "// behavior comes from the runInSandbox mock",
    entityType: "savedGroup",
    entityId,
    incrementalChangesOnly: false,
  });
}

function rawGroup() {
  return mongoose.connection
    .collection("savedgroups")
    .findOne({ id: GROUP_ID });
}

describe("saved group custom-hook validation gate", () => {
  const { setReqContext } = setupApp();

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

  it("blocks an update when a validateSavedGroup hook throws", async () => {
    const context = makeContext();
    setReqContext(context);
    await seedSavedGroup();
    await seedGlobalSavedGroupHook();

    mockRunInSandbox.mockResolvedValue({
      ok: false,
      error: "Rejected by hook",
      warnings: [],
    });

    const group = await context.models.savedGroups.getById(GROUP_ID);
    expect(group).not.toBeNull();

    await expect(
      context.models.savedGroups.update(group!, { description: "changed" }),
    ).rejects.toThrow("Rejected by hook");

    // Doc unchanged
    const raw = await rawGroup();
    expect(raw?.description).toBe("original");
  });

  it("allows an update when the hook passes", async () => {
    const context = makeContext();
    setReqContext(context);
    await seedSavedGroup();
    await seedGlobalSavedGroupHook();

    mockRunInSandbox.mockResolvedValue({ ok: true, warnings: [] });

    const group = await context.models.savedGroups.getById(GROUP_ID);
    await context.models.savedGroups.update(group!, { description: "changed" });

    const raw = await rawGroup();
    expect(raw?.description).toBe("changed");
  });

  it("blocks a create when a validateSavedGroup hook throws", async () => {
    const context = makeContext();
    setReqContext(context);
    await seedGlobalSavedGroupHook();

    mockRunInSandbox.mockResolvedValue({
      ok: false,
      error: "Rejected on create",
      warnings: [],
    });

    await expect(
      context.models.savedGroups.create({
        groupName: "New group",
        type: "condition",
        condition: '{"country": "CA"}',
        owner: "",
        projects: [],
      }),
    ).rejects.toThrow("Rejected on create");

    const count = await mongoose.connection
      .collection("savedgroups")
      .countDocuments();
    expect(count).toBe(0);
  });

  it("blocks an update on an unacknowledged soft warning, and allows it with ignoreWarnings", async () => {
    await seedSavedGroup();
    await seedGlobalSavedGroupHook();

    mockRunInSandbox.mockResolvedValue({
      ok: true,
      warnings: ["consider adding a description"],
    });

    const warnCtx = makeContext();
    setReqContext(warnCtx);
    const group = await warnCtx.models.savedGroups.getById(GROUP_ID);
    await expect(
      warnCtx.models.savedGroups.update(group!, { description: "changed" }),
    ).rejects.toThrow("consider adding a description");
    expect((await rawGroup())?.description).toBe("original");

    // The ignoreWarnings retry succeeds
    const ignoreCtx = makeContext({ ignoreWarnings: "true" });
    setReqContext(ignoreCtx);
    const group2 = await ignoreCtx.models.savedGroups.getById(GROUP_ID);
    await ignoreCtx.models.savedGroups.update(group2!, {
      description: "changed",
    });
    expect((await rawGroup())?.description).toBe("changed");
  });

  it("does not run a hook scoped to a different saved group", async () => {
    const context = makeContext();
    setReqContext(context);
    await seedSavedGroup();
    await seedEntityScopedHook("grp_some_other_group");

    // If the scoped hook were (wrongly) applied, this rejection would block
    // the update. It must not.
    mockRunInSandbox.mockResolvedValue({
      ok: false,
      error: "should not run",
      warnings: [],
    });

    const group = await context.models.savedGroups.getById(GROUP_ID);
    await context.models.savedGroups.update(group!, { description: "changed" });

    expect(mockRunInSandbox).not.toHaveBeenCalled();
    expect((await rawGroup())?.description).toBe("changed");
  });
});
