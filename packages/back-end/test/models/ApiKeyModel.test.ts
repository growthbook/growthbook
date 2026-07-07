import { Collection } from "mongodb";
import { ApiKeyInterface } from "shared/types/apikey";

// Break the module cycle ApiKeyModel -> api-key.util/services-organizations ->
// OrganizationModel/DataSourceModel -> context -> ApiKeyModel, which throws a
// TDZ error when the test entrypoint is ApiKeyModel itself.
jest.mock("back-end/src/util/api-key.util", () => ({
  generateEncryptionKey: jest.fn(async () => "enc_key"),
  generateSigningKey: jest.fn((prefix: string) => `${prefix}generated`),
  migrateApiKey: jest.fn((doc) => doc),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getEnvironmentIdsFromOrg: (org: {
    settings?: { environments?: { id: string }[] };
  }) => (org.settings?.environments ?? []).map((e) => e.id),
}));

import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";

import { Context } from "back-end/src/models/BaseModel";

const updateIndexesMock = jest.fn();

class TestApiKeyModel extends ApiKeyModel {
  public dangerousGetCollectionMock = jest.fn();

  protected updateIndexes() {
    return updateIndexesMock();
  }

  protected _dangerousGetCollection(): Collection {
    return this.dangerousGetCollectionMock();
  }

  public exposeCanUpdate(
    apiKey: ApiKeyInterface,
    updates: Partial<ApiKeyInterface>,
  ): boolean {
    return this.canUpdate(apiKey, updates);
  }
}

const makeContext = (overrides: Record<string, unknown> = {}) =>
  ({
    org: {
      id: "org_1",
      deactivatedRoles: [],
      settings: {
        environments: [{ id: "production" }, { id: "staging" }],
      },
    },
    userId: "u_self",
    permissions: {
      canCreateApiKey: jest.fn(() => true),
      canUpdateApiKey: jest.fn(() => true),
      canDeleteApiKey: jest.fn(() => true),
      canReadSingleProjectResource: jest.fn(() => true),
      throwPermissionError: jest.fn(() => {
        throw new Error("You do not have permission to perform this action");
      }),
    },
    hasPremiumFeature: jest.fn(() => true),
    getProjects: jest.fn(async () => [{ id: "prj_coworker" }]),
    populateForeignRefs: jest.fn(),
    registerTags: jest.fn(),
    throwBadRequestError: (message: string) => {
      throw new Error(message);
    },
    throwNotFoundError: (message?: string) => {
      throw new Error(message || "Not found");
    },
    throwPlanDoesNotAllowError: (message: string) => {
      throw new Error(message);
    },
    ...overrides,
  }) as unknown as Context;

const orgSecretKey = (
  overrides: Partial<ApiKeyInterface> = {},
): ApiKeyInterface =>
  ({
    id: "key_1",
    key: "secret_experimenter_abc123",
    organization: "org_1",
    secret: true,
    role: "experimenter",
    description: "coworker gateway",
    environment: "",
    project: "",
    limitAccessByEnvironment: false,
    environments: [],
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    ...overrides,
  }) as ApiKeyInterface;

// Everything the required full-replacement signature needs; spread overrides on top
const baseUpdate = {
  roleId: "experimenter",
  limitAccessByEnvironment: false,
  environments: [] as string[],
  projectRoles: [] as NonNullable<ApiKeyInterface["projectRoles"]>,
};

describe("ApiKeyModel.canUpdate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("still allows toggling disabled with the delete permission", () => {
    const model = new TestApiKeyModel(makeContext());
    expect(model.exposeCanUpdate(orgSecretKey(), { disabled: true })).toBe(
      true,
    );
  });

  it("allows permission-field updates on an org secret key with manageApiKeys", () => {
    const model = new TestApiKeyModel(makeContext());
    expect(
      model.exposeCanUpdate(orgSecretKey(), {
        role: "admin",
        projectRoles: [
          {
            project: "prj_coworker",
            role: "experimenter",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
        environments: [],
        limitAccessByEnvironment: false,
        description: "updated",
      }),
    ).toBe(true);
  });

  it("denies permission-field updates without manageApiKeys", () => {
    const context = makeContext();
    (context.permissions.canUpdateApiKey as jest.Mock).mockReturnValue(false);
    const model = new TestApiKeyModel(context);
    expect(model.exposeCanUpdate(orgSecretKey(), { role: "admin" })).toBe(
      false,
    );
  });

  it("denies permission-field updates on PATs", () => {
    const model = new TestApiKeyModel(makeContext());
    expect(
      model.exposeCanUpdate(orgSecretKey({ userId: "u_self" }), {
        role: "admin",
      }),
    ).toBe(false);
  });

  it("denies permission-field updates on SDK endpoint keys", () => {
    const model = new TestApiKeyModel(makeContext());
    expect(
      model.exposeCanUpdate(
        orgSecretKey({ secret: false, environment: "production" }),
        { role: "admin" },
      ),
    ).toBe(false);
  });

  it("denies edits to identity fields and mixed disabled updates", () => {
    const model = new TestApiKeyModel(makeContext());
    expect(
      model.exposeCanUpdate(orgSecretKey(), { key: "secret_admin_forged" }),
    ).toBe(false);
    expect(model.exposeCanUpdate(orgSecretKey(), { userId: "u_other" })).toBe(
      false,
    );
    expect(model.exposeCanUpdate(orgSecretKey(), { encryptionKey: "x" })).toBe(
      false,
    );
    expect(
      model.exposeCanUpdate(orgSecretKey(), { disabled: true, role: "admin" }),
    ).toBe(false);
  });
});

describe("ApiKeyModel.updateOrganizationApiKey", () => {
  beforeEach(() => jest.clearAllMocks());

  const setupModel = (
    doc: ApiKeyInterface | null,
    contextOverrides: Record<string, unknown> = {},
  ) => {
    const context = makeContext(contextOverrides);
    const model = new TestApiKeyModel(context);
    const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
    model.dangerousGetCollectionMock.mockReturnValue({
      findOne: jest.fn(async () => doc),
      updateOne,
    });
    return { model, context, updateOne };
  };

  const setOf = (updateOne: jest.Mock) =>
    (
      updateOne.mock.calls[0] as unknown as [
        Record<string, unknown>,
        { $set: Record<string, unknown>; $unset?: Record<string, unknown> },
      ]
    )[1];

  it("updates role and project roles in place, scoped to the org", async () => {
    const { model, updateOne } = setupModel(orgSecretKey());

    await model.updateOrganizationApiKey("key_1", {
      ...baseUpdate,
      roleId: "readonly",
      projectRoles: [
        {
          project: "prj_coworker",
          role: "experimenter",
          limitAccessByEnvironment: false,
          environments: [],
        },
      ],
    });

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, mutation] = updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    // The key value is untouched (no rotation) and the write is org-scoped
    expect(filter).toMatchObject({
      key: "secret_experimenter_abc123",
      organization: "org_1",
    });
    expect(mutation.$set.role).toBe("readonly");
    expect(mutation.$set.projectRoles).toEqual([
      {
        project: "prj_coworker",
        role: "experimenter",
        limitAccessByEnvironment: false,
        environments: [],
      },
    ]);
    expect(mutation.$set).not.toHaveProperty("key");
  });

  it("clears project roles with an empty array, without the premium gate", async () => {
    const { model, updateOne } = setupModel(
      orgSecretKey({
        projectRoles: [
          {
            project: "prj_coworker",
            role: "experimenter",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      }),
      { hasPremiumFeature: jest.fn(() => false) },
    );

    await model.updateOrganizationApiKey("key_1", baseUpdate);

    const mutation = setOf(updateOne);
    expect(mutation.$unset).toHaveProperty("projectRoles");
    expect(mutation.$set).not.toHaveProperty("projectRoles");
  });

  it("rejects PATs", async () => {
    const { model } = setupModel(orgSecretKey({ userId: "u_self" }));
    await expect(
      model.updateOrganizationApiKey("key_1", baseUpdate),
    ).rejects.toThrow(
      "Only organization secret API keys support permission updates",
    );
  });

  it("rejects SDK endpoint keys", async () => {
    const { model } = setupModel(
      orgSecretKey({ secret: false, environment: "production" }),
    );
    await expect(
      model.updateOrganizationApiKey("key_1", baseUpdate),
    ).rejects.toThrow(
      "Only organization secret API keys support permission updates",
    );
  });

  it("404s when the key does not exist", async () => {
    const { model } = setupModel(null);
    await expect(
      model.updateOrganizationApiKey("key_missing", baseUpdate),
    ).rejects.toThrow("API key not found: key_missing");
  });

  it("rejects roles that do not exist or are deactivated", async () => {
    const { model } = setupModel(orgSecretKey());
    await expect(
      model.updateOrganizationApiKey("key_1", {
        ...baseUpdate,
        roleId: "not_a_role",
      }),
    ).rejects.toThrow("Invalid role: not_a_role");

    const { model: model2 } = setupModel(orgSecretKey(), {
      org: {
        id: "org_1",
        deactivatedRoles: ["admin"],
        settings: { environments: [{ id: "production" }] },
      },
    });
    await expect(
      model2.updateOrganizationApiKey("key_1", {
        ...baseUpdate,
        roleId: "admin",
      }),
    ).rejects.toThrow("Role has been deactivated: admin");
  });

  it("rejects environments not defined in the org", async () => {
    const { model } = setupModel(orgSecretKey());
    await expect(
      model.updateOrganizationApiKey("key_1", {
        ...baseUpdate,
        limitAccessByEnvironment: true,
        environments: ["nope"],
      }),
    ).rejects.toThrow("Invalid environment: nope");
  });

  it("rejects unknown projects in project roles", async () => {
    const { model } = setupModel(orgSecretKey());
    await expect(
      model.updateOrganizationApiKey("key_1", {
        ...baseUpdate,
        projectRoles: [
          {
            project: "prj_missing",
            role: "experimenter",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      }),
    ).rejects.toThrow("Invalid project: prj_missing");
  });

  it("enforces the advanced-permissions premium gate like creation does", async () => {
    const { model } = setupModel(orgSecretKey(), {
      hasPremiumFeature: jest.fn(() => false),
    });
    await expect(
      model.updateOrganizationApiKey("key_1", {
        ...baseUpdate,
        projectRoles: [
          {
            project: "prj_coworker",
            role: "experimenter",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      }),
    ).rejects.toThrow(
      "Your plan does not support project-level permissions on API keys.",
    );
  });

  it("denies the update without manageApiKeys, even when nothing would change", async () => {
    const doc = orgSecretKey();
    const { model, context, updateOne } = setupModel(doc);
    (context.permissions.canUpdateApiKey as jest.Mock).mockReturnValue(false);
    // A value-matching no-op must not act as a permission-free probe of the
    // key's current settings
    await expect(
      model.updateOrganizationApiKey("key_1", {
        ...baseUpdate,
        roleId: doc.role || "",
      }),
    ).rejects.toThrow("You do not have permission to perform this action");
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("does not re-validate unchanged fields, so stale state can't block unrelated edits", async () => {
    // Org downgraded after minting a key with env restrictions; role edits
    // must still work
    const { model: m1, updateOne: u1 } = setupModel(
      orgSecretKey({
        limitAccessByEnvironment: true,
        environments: ["production"],
      }),
      { hasPremiumFeature: jest.fn(() => false) },
    );
    await m1.updateOrganizationApiKey("key_1", {
      ...baseUpdate,
      roleId: "readonly",
      limitAccessByEnvironment: true,
      environments: ["production"],
    });
    expect(setOf(u1).$set.role).toBe("readonly");

    // Role deactivated after the fact; description-only edits must still work
    const { model: m2, updateOne: u2 } = setupModel(orgSecretKey(), {
      org: {
        id: "org_1",
        deactivatedRoles: ["experimenter"],
        settings: { environments: [{ id: "production" }] },
      },
    });
    await m2.updateOrganizationApiKey("key_1", {
      ...baseUpdate,
      description: "renamed",
    });
    expect(setOf(u2).$set.description).toBe("renamed");
  });

  it("allows turning the env restriction off even when the list holds a deleted environment", async () => {
    const { model, updateOne } = setupModel(
      orgSecretKey({
        limitAccessByEnvironment: true,
        environments: ["deleted-env"],
      }),
    );
    await model.updateOrganizationApiKey("key_1", {
      ...baseUpdate,
      limitAccessByEnvironment: false,
      environments: ["deleted-env"],
    });
    expect(setOf(updateOne).$set.limitAccessByEnvironment).toBe(false);
  });
});
