import { cloneDeep } from "lodash";
import { OrganizationInterface } from "shared/types/organization";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ConfigFile } from "back-end/src/init/config";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  findOrganizationById,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  getContextForAgendaJobByOrgObject,
  importConfig,
} from "back-end/src/services/organizations";

jest.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: jest.fn(),
  updateOrganization: jest.fn(),
}));
jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionsByOrganization: jest.fn(),
}));
jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));
jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  orgHasPremiumFeature: jest.fn(),
}));
jest.mock("back-end/src/services/plan-limits", () => ({
  getEffectiveOrgLimits: () => ({ orgSupportsRoles: () => true }),
}));
jest.mock("back-end/src/services/context", () => ({
  ReqContextClass: class {
    org: OrganizationInterface;
    environments: string[];
    models = { segments: { getById: jest.fn() } };
    hasPremiumFeature = jest.fn(() => true);
    permissions = {
      canManageTeam: jest.fn(() => true),
      throwPermissionError: () => {
        throw new Error("Permission denied");
      },
    };

    constructor({ org }: { org: OrganizationInterface }) {
      this.org = org;
      this.environments = jest
        .requireActual("back-end/src/util/organization.util")
        .getEnvironmentIdsFromOrg(org);
    }
  },
}));

describe("organization config import", () => {
  let organization: OrganizationInterface;
  let storedOrganization: OrganizationInterface;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(orgHasPremiumFeature).mockReturnValue(true);
    organization = {
      id: "org-import",
      name: "Import test",
      url: "import-test",
      dateCreated: new Date(),
      ownerEmail: "owner@example.com",
      members: [],
      invites: [],
      settings: {
        confidenceLevel: 0.95,
        environments: [
          { id: "production", description: "", projects: ["old-project"] },
          { id: "staging", description: "" },
        ],
      },
    };
    storedOrganization = cloneDeep(organization);
    jest.mocked(updateOrganization).mockImplementation(async (id, updates) => {
      expect(id).toBe(organization.id);
      storedOrganization = { ...storedOrganization, ...cloneDeep(updates) };
    });
    jest
      .mocked(findOrganizationById)
      .mockImplementation(async () => cloneDeep(storedOrganization));
    jest.mocked(findSDKConnectionsByOrganization).mockResolvedValue([]);
  });

  it("imports a default role restricted to an environment defined in the same import", async () => {
    const context = getContextForAgendaJobByOrgObject(organization);
    const original = cloneDeep(organization);
    const settings = {
      environments: [{ id: "qa", description: "" }],
      defaultRole: {
        role: "engineer",
        limitAccessByEnvironment: true,
        environments: ["qa"],
      },
    };

    await importConfig(context, { organization: { settings } });

    expect(storedOrganization.settings).toEqual({
      ...original.settings,
      ...settings,
    });
    expect(context.org).toEqual(original);
    expect(queueSDKPayloadRefresh).toHaveBeenCalledTimes(1);
  });

  it("uses existing environments when the import does not replace them", async () => {
    const defaultRole = {
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["staging"],
    };

    await importConfig(getContextForAgendaJobByOrgObject(organization), {
      organization: { settings: { defaultRole } },
    });

    expect(storedOrganization.settings?.defaultRole).toEqual(defaultRole);
    expect(storedOrganization.settings?.environments).toEqual(
      organization.settings?.environments,
    );
  });

  it("rejects a malformed projectRoles instead of dropping the override", async () => {
    const config = {
      organization: {
        settings: {
          defaultRole: {
            role: "engineer",
            limitAccessByEnvironment: false,
            environments: [],
            // Object instead of an array: must be rejected, not silently
            // stripped into engineer-everywhere.
            projectRoles: {
              "restricted-project": {
                project: "restricted-project",
                role: "noaccess",
                limitAccessByEnvironment: false,
                environments: [],
              },
            },
          },
        },
      },
    } as unknown as ConfigFile;

    await expect(
      importConfig(getContextForAgendaJobByOrgObject(organization), config),
    ).rejects.toThrow(/defaultRole/i);
    expect(storedOrganization.settings?.defaultRole).toBeUndefined();
  });

  it("fills defaults for a minimal legacy default role", async () => {
    await importConfig(getContextForAgendaJobByOrgObject(organization), {
      organization: { settings: { defaultRole: { role: "engineer" } } },
    } as unknown as ConfigFile);

    expect(storedOrganization.settings?.defaultRole).toEqual({
      role: "engineer",
      limitAccessByEnvironment: false,
      environments: [],
    });
  });

  it("prunes a default-role environment that the same import removes", async () => {
    const org = cloneDeep(organization);
    const defaultRole = {
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["production"],
    };
    org.settings = { ...org.settings, defaultRole };
    storedOrganization = cloneDeep(org);

    await importConfig(getContextForAgendaJobByOrgObject(org), {
      organization: {
        settings: {
          environments: [{ id: "staging", description: "" }],
          defaultRole,
        },
      },
    });

    expect(storedOrganization.settings?.defaultRole).toEqual({
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: [],
    });
  });

  it.each(["unknown", "staging"])(
    "rejects a default role referencing %s when absent from the imported environments",
    async (environment) => {
      await expect(
        importConfig(getContextForAgendaJobByOrgObject(organization), {
          organization: {
            settings: {
              environments: [{ id: "qa", description: "" }],
              defaultRole: {
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: [environment],
              },
            },
          },
        }),
      ).rejects.toThrow(`${environment} is not a valid environment ID`);

      expect(updateOrganization).not.toHaveBeenCalled();
      expect(queueSDKPayloadRefresh).not.toHaveBeenCalled();
    },
  );

  it.each(["permission", "license"])(
    "still requires the current organization's %s to update the default role",
    async (gate) => {
      const context = getContextForAgendaJobByOrgObject(organization);
      if (gate === "permission") {
        jest.spyOn(context.permissions, "canManageTeam").mockReturnValue(false);
      } else {
        jest.spyOn(context, "hasPremiumFeature").mockReturnValue(false);
      }

      await expect(
        importConfig(context, {
          organization: {
            settings: {
              environments: [{ id: "qa", description: "" }],
              defaultRole: {
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: ["qa"],
              },
            },
          },
        }),
      ).rejects.toThrow(
        gate === "permission"
          ? "Permission denied"
          : "Must have a commercial License Key",
      );

      expect(updateOrganization).not.toHaveBeenCalled();
    },
  );

  it("refreshes every connection using saved settings, including removed environments", async () => {
    const context = getContextForAgendaJobByOrgObject(organization);
    const connections: SDKConnectionInterface[] = ["production", "staging"].map(
      (environment) => ({
        id: `connection-${environment}`,
        organization: organization.id,
        name: environment,
        key: `sdk-${environment}`,
        environment,
        projects: ["new-project"],
        languages: ["javascript"],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        encryptPayload: false,
        encryptionKey: "",
        connected: false,
        proxy: {
          enabled: false,
          host: "",
          signingKey: "",
          connected: false,
          version: "",
          error: "",
          lastError: null,
        },
      }),
    );
    jest
      .mocked(findSDKConnectionsByOrganization)
      .mockResolvedValue(connections);

    await importConfig(context, {
      organization: {
        settings: {
          environments: [
            { id: "production", description: "", projects: ["new-project"] },
            { id: "qa", description: "" },
          ],
        },
      },
    });

    expect(queueSDKPayloadRefresh).toHaveBeenCalledTimes(1);
    const [refresh] = jest.mocked(queueSDKPayloadRefresh).mock.calls[0];
    expect(refresh.context).not.toBe(context);
    expect(refresh.context.org.settings).toEqual({
      confidenceLevel: 0.95,
      environments: [
        { id: "production", description: "", projects: ["new-project"] },
        { id: "qa", description: "" },
      ],
    });
    expect(refresh.context.environments).toEqual(["production", "qa"]);
    expect(refresh.sdkConnections).toEqual(connections);
    expect(refresh.payloadKeys).toEqual([
      { environment: "production", project: "" },
      { environment: "qa", project: "" },
    ]);
    expect(refresh.treatEmptyProjectAsGlobal).toBe(true);
    expect(refresh.auditContext).toEqual({
      event: "config imported",
      model: "organization",
      id: organization.id,
    });
    expect(context.org.settings?.environments?.[0].projects).toEqual([
      "old-project",
    ]);
  });

  it("requests a refresh for legacy API keys even without SDK connections", async () => {
    await importConfig(getContextForAgendaJobByOrgObject(organization), {
      organization: {
        settings: { environments: [{ id: "qa", description: "" }] },
      },
    });

    expect(queueSDKPayloadRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadKeys: [{ environment: "qa", project: "" }],
        sdkConnections: [],
      }),
    );
  });

  it("refreshes when the import matches a stale request snapshot but overwrites a concurrent change", async () => {
    const context = getContextForAgendaJobByOrgObject(organization);
    const importedSettings = cloneDeep(organization.settings || {});
    storedOrganization.settings = {
      ...storedOrganization.settings,
      environments: [
        { id: "production", description: "", projects: ["concurrent-project"] },
      ],
    };

    await importConfig(context, {
      organization: { settings: importedSettings },
    });

    expect(storedOrganization.settings?.environments).toEqual([
      { id: "production", description: "", projects: ["old-project"] },
      { id: "staging", description: "" },
    ]);
    expect(queueSDKPayloadRefresh).toHaveBeenCalledTimes(1);
    const [refresh] = jest.mocked(queueSDKPayloadRefresh).mock.calls[0];
    expect(refresh.context).not.toBe(context);
    expect(refresh.context.org.settings).toEqual(storedOrganization.settings);
  });

  it.each<ConfigFile>([
    { organization: { settings: {} } },
    { organization: { settings: { confidenceLevel: 0.95 } } },
    {
      organization: {
        settings: {
          environments: [
            { id: "production", description: "", projects: ["old-project"] },
            { id: "staging", description: "" },
          ],
        },
      },
    },
  ])(
    "refreshes settings writes even when they match the request snapshot: %j",
    async (config) => {
      await importConfig(
        getContextForAgendaJobByOrgObject(organization),
        config,
      );

      expect(queueSDKPayloadRefresh).toHaveBeenCalledTimes(1);
      const [refresh] = jest.mocked(queueSDKPayloadRefresh).mock.calls[0];
      expect(refresh.context.org.settings).toEqual(storedOrganization.settings);
    },
  );

  it("skips refresh when organization settings are omitted", async () => {
    await importConfig(getContextForAgendaJobByOrgObject(organization), {});

    expect(updateOrganization).not.toHaveBeenCalled();
    expect(queueSDKPayloadRefresh).not.toHaveBeenCalled();
    expect(findOrganizationById).not.toHaveBeenCalled();
    expect(findSDKConnectionsByOrganization).not.toHaveBeenCalled();
  });

  it("does not refresh when saving settings fails", async () => {
    jest
      .mocked(updateOrganization)
      .mockRejectedValueOnce(new Error("Write failed"));

    await expect(
      importConfig(getContextForAgendaJobByOrgObject(organization), {
        organization: {
          settings: { environments: [{ id: "qa", description: "" }] },
        },
      }),
    ).rejects.toThrow("Write failed");

    expect(queueSDKPayloadRefresh).not.toHaveBeenCalled();
    expect(findOrganizationById).not.toHaveBeenCalled();
  });

  it("refreshes saved settings even when a later resource import fails", async () => {
    const context = getContextForAgendaJobByOrgObject(organization);
    jest
      .spyOn(context.models.segments, "getById")
      .mockImplementationOnce(async () => {
        expect(queueSDKPayloadRefresh).toHaveBeenCalledTimes(1);
        throw new Error("Segment unavailable");
      });

    await expect(
      importConfig(context, {
        organization: {
          settings: { environments: [{ id: "qa", description: "" }] },
        },
        segments: {
          example: {
            name: "Example",
            description: "",
            owner: "",
            datasource: "ds_1",
            userIdType: "user_id",
            type: "SQL",
            sql: "SELECT user_id FROM users",
          },
        },
      }),
    ).rejects.toThrow("Segment unavailable");

    expect(storedOrganization.settings?.environments).toEqual([
      { id: "qa", description: "" },
    ]);
  });
});
