import { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

jest.mock("back-end/src/services/audit", () => ({
  createModelAuditLogger: () => ({
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logDelete: jest.fn(),
  }),
}));

// The plan's role gate is toggled per test; the real lookup evaluates a remote
// feature flag.
let mockSupportsRoles = true;
jest.mock("back-end/src/services/plan-limits", () => ({
  ...jest.requireActual("back-end/src/services/plan-limits"),
  getEffectiveOrgLimits: () => ({ orgSupportsRoles: () => mockSupportsRoles }),
}));

const org: OrganizationInterface = {
  id: "org_apikeys",
  url: "",
  dateCreated: new Date(),
  name: "Test org",
  ownerEmail: "test@test.com",
  members: [],
  invites: [],
  settings: { environments: [{ id: "production" }] },
};

// Built after connecting, since creating a context sets up the models, which
// needs the database.
let context: ReqContextClass;
const create = (
  roleId: string,
  extra: Partial<
    Parameters<
      ReqContextClass["models"]["apiKeys"]["createOrganizationApiKey"]
    >[0]
  > = {},
) =>
  context.models.apiKeys.createOrganizationApiKey({
    description: "key",
    roleId,
    ...extra,
  });

describe("ApiKeyModel traceIngest keys", () => {
  beforeAll(async () => {
    await connectTestMongo();
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
    });
    // Premium gates aren't under test here.
    jest.spyOn(context, "hasPremiumFeature").mockReturnValue(true);
  });
  afterAll(async () => {
    await waitForIndexes();
    await disconnectTestMongo();
  });
  beforeEach(() => {
    mockSupportsRoles = true;
  });

  it("creates a key with a secret_traceIngest_ prefix", async () => {
    const key = await create("traceIngest");
    expect(key.role).toBe("traceIngest");
    expect(key.secret).toBe(true);
    expect(key.userId).toBeUndefined();

    const unredacted = await context.models.apiKeys.getUnredactedSecretKey(
      key.id,
    );
    expect(unredacted?.key).toMatch(/^secret_traceIngest_[A-Za-z0-9]+$/);
  });

  it("can be created on plans limited to the admin role", async () => {
    mockSupportsRoles = false;
    await expect(create("readonly")).rejects.toThrow(
      "only supports the admin role",
    );
    await expect(create("traceIngest")).resolves.toMatchObject({
      role: "traceIngest",
    });
  });

  it.each([
    [
      "an environment limit",
      { limitAccessByEnvironment: true, environments: ["production"] },
    ],
    ["environments", { environments: ["production"] }],
    [
      "additional roles",
      {
        additionalRoles: [
          {
            role: "readonly",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      },
    ],
    [
      "project roles",
      {
        projectRoles: [
          {
            project: "prj_a",
            role: "readonly",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      },
    ],
  ])("rejects a traceIngest key with %s", async (_name, extra) => {
    await expect(create("traceIngest", extra)).rejects.toThrow(
      "The traceIngest role can't have",
    );
  });

  it("rejects traceIngest as an additional role on another key", async () => {
    await expect(
      create("readonly", {
        additionalRoles: [
          {
            role: "traceIngest",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      }),
    ).rejects.toThrow("can only be a key's base role");
  });

  it("won't change a key's role to or from traceIngest", async () => {
    const ingest = await create("traceIngest");
    await expect(
      context.models.apiKeys.updateSecretApiKeyPermissions(ingest.id, {
        role: "admin",
      }),
    ).rejects.toThrow("Create a new key instead");

    const admin = await create("admin");
    await expect(
      context.models.apiKeys.updateSecretApiKeyPermissions(admin.id, {
        role: "traceIngest",
        limitAccessByEnvironment: false,
        environments: [],
      }),
    ).rejects.toThrow("Create a new key instead");
  });

  it("still lets a traceIngest key's description change", async () => {
    const ingest = await create("traceIngest");
    const { after } =
      await context.models.apiKeys.updateSecretApiKeyPermissions(ingest.id, {
        role: "traceIngest",
        description: "renamed",
      });
    expect(after).toMatchObject({
      role: "traceIngest",
      description: "renamed",
    });
  });
});
