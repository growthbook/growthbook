import { vi } from "vitest";
import { cloneDeep } from "lodash";
import { OrganizationInterface } from "shared/types/organization";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ConfigFile } from "back-end/src/init/config";
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

vi.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: vi.fn(),
  updateOrganization: vi.fn(),
}));
vi.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionsByOrganization: vi.fn(),
}));
vi.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: vi.fn(),
}));
vi.mock("back-end/src/services/context", async () => {
  const { getEnvironmentIdsFromOrg } = await vi.importActual<
    typeof import("back-end/src/util/organization.util")
  >("back-end/src/util/organization.util");
  return {
    ReqContextClass: class {
      org: OrganizationInterface;
      environments: string[];
      models = { segments: { getById: vi.fn() } };

      constructor({ org }: { org: OrganizationInterface }) {
        this.org = org;
        this.environments = getEnvironmentIdsFromOrg(org);
      }
    },
  };
});

describe("organization config import payload refresh", () => {
  let organization: OrganizationInterface;
  let storedOrganization: OrganizationInterface;

  beforeEach(() => {
    vi.resetAllMocks();
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
    vi.mocked(updateOrganization).mockImplementation(async (id, updates) => {
      expect(id).toBe(organization.id);
      storedOrganization = { ...storedOrganization, ...cloneDeep(updates) };
    });
    vi.mocked(findOrganizationById).mockImplementation(async () =>
      cloneDeep(storedOrganization),
    );
    vi.mocked(findSDKConnectionsByOrganization).mockResolvedValue([]);
  });

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
    vi.mocked(findSDKConnectionsByOrganization).mockResolvedValue(connections);

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
    const [refresh] = vi.mocked(queueSDKPayloadRefresh).mock.calls[0];
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
    const [refresh] = vi.mocked(queueSDKPayloadRefresh).mock.calls[0];
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
      const [refresh] = vi.mocked(queueSDKPayloadRefresh).mock.calls[0];
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
    vi.mocked(updateOrganization).mockRejectedValueOnce(
      new Error("Write failed"),
    );

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
    vi.spyOn(context.models.segments, "getById").mockImplementationOnce(
      async () => {
        expect(queueSDKPayloadRefresh).toHaveBeenCalledTimes(1);
        throw new Error("Segment unavailable");
      },
    );

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
