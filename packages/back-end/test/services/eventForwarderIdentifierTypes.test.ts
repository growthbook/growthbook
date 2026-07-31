import type {
  DataSourceInterface,
  DataSourceSettings,
} from "shared/types/datasource";
import {
  applyEventForwarderIdentifierTypeUpdates,
  getEventForwarderUserIdTypeRenames,
} from "back-end/src/services/eventForwarder/identifierTypes";
import * as EventForwarderConfig from "back-end/src/services/eventForwarder/config";
import * as EventForwarderSinkParams from "back-end/src/services/eventForwarder/sinkParams";
import * as DataSourceService from "back-end/src/services/datasource";

jest.mock("back-end/src/services/eventForwarder/config");
jest.mock("back-end/src/services/eventForwarder/sinkParams");
jest.mock("back-end/src/services/eventForwarder/factTable");
jest.mock("back-end/src/services/eventForwarder/warehouseSync");
jest.mock("back-end/src/services/datasource");

const mockedGetEventForwarder =
  EventForwarderConfig.getEventForwarderForDatasource as jest.MockedFunction<
    typeof EventForwarderConfig.getEventForwarderForDatasource
  >;
const mockedBuildExposureQueryParams =
  EventForwarderSinkParams.buildExposureQueryParams as jest.MockedFunction<
    typeof EventForwarderSinkParams.buildExposureQueryParams
  >;
const mockedGetSourceIntegrationObject =
  DataSourceService.getSourceIntegrationObject as jest.MockedFunction<
    typeof DataSourceService.getSourceIntegrationObject
  >;

const MANAGED_USER_ID = {
  userIdType: "user_id",
  description: "Managed by Event Forwarder.",
  attributes: ["user_id"],
  managedBy: "api" as const,
  sourceAttribute: "user_id",
};

const MANAGED_EXPOSURE_QUERY = {
  id: "exq_stable",
  userIdType: "user_id",
  name: "user_id",
  sourceAttribute: "user_id",
  dimensions: ["country"],
  managedBy: "api" as const,
  query: "SELECT `user_id`",
};

function ds(settings: DataSourceSettings): DataSourceInterface {
  return {
    id: "ds_1",
    organization: "org1",
    name: "ds",
    type: "bigquery",
    description: "",
    params: {} as DataSourceInterface["params"],
    settings,
    projects: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
}

function context() {
  return {
    org: {
      id: "org1",
      settings: {
        attributeSchema: [
          { property: "user_id", datatype: "string", hashAttribute: true },
        ],
      },
    },
  };
}

describe("getEventForwarderUserIdTypeRenames", () => {
  it("detects a rename by source attribute, not by name", () => {
    expect(
      getEventForwarderUserIdTypeRenames(
        [MANAGED_USER_ID],
        [{ ...MANAGED_USER_ID, userIdType: "logged_in_user" }],
      ),
    ).toEqual([
      { from: "user_id", to: "logged_in_user", sourceAttribute: "user_id" },
    ]);
  });

  it("returns nothing when the name is unchanged", () => {
    expect(
      getEventForwarderUserIdTypeRenames([MANAGED_USER_ID], [MANAGED_USER_ID]),
    ).toEqual([]);
  });

  it("ignores user-created identifier types", () => {
    expect(
      getEventForwarderUserIdTypeRenames(
        [{ userIdType: "custom_id" }],
        [{ userIdType: "renamed_custom_id" }],
      ),
    ).toEqual([]);
  });
});

describe("applyEventForwarderIdentifierTypeUpdates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetEventForwarder.mockResolvedValue({
      id: "efc_1",
      datasourceId: "ds_1",
      sinkType: "bigquery",
    } as never);
    mockedGetSourceIntegrationObject.mockReturnValue({
      params: { defaultProject: "my-project" },
    } as never);
    mockedBuildExposureQueryParams.mockReturnValue({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
      tablePrefix: "gb",
    });
  });

  it("rejects a duplicate identifier type name", async () => {
    await expect(
      applyEventForwarderIdentifierTypeUpdates({
        context: context() as never,
        datasource: ds({ userIdTypes: [MANAGED_USER_ID] }),
        settings: {
          userIdTypes: [MANAGED_USER_ID, { userIdType: "USER_ID" }],
        },
      }),
    ).rejects.toThrow("Identifier type USER_ID is already in use");
  });

  it("updates the managed exposure query on rename and keeps its id", async () => {
    const result = await applyEventForwarderIdentifierTypeUpdates({
      context: context() as never,
      datasource: ds({
        userIdTypes: [MANAGED_USER_ID],
        queries: { exposure: [MANAGED_EXPOSURE_QUERY] },
      }),
      settings: {
        userIdTypes: [{ ...MANAGED_USER_ID, userIdType: "logged_in_user" }],
        queries: { exposure: [MANAGED_EXPOSURE_QUERY] },
      },
    });

    expect(result.renames).toEqual([
      { from: "user_id", to: "logged_in_user", sourceAttribute: "user_id" },
    ]);

    const exposure = result.settings.queries?.exposure ?? [];
    expect(exposure).toHaveLength(1);
    expect(exposure[0].id).toBe("exq_stable");
    expect(exposure[0].userIdType).toBe("logged_in_user");
    expect(exposure[0].name).toBe("logged_in_user");
    expect(exposure[0].query).toContain("AS `logged_in_user`");
    // The value still comes from the linked attribute.
    expect(exposure[0].query).toContain('$."user_id"');
    expect(exposure[0].dimensions).toEqual(["country"]);
  });

  it("rewrites identity join references to the renamed identifier", async () => {
    const result = await applyEventForwarderIdentifierTypeUpdates({
      context: context() as never,
      datasource: ds({ userIdTypes: [MANAGED_USER_ID] }),
      settings: {
        userIdTypes: [{ ...MANAGED_USER_ID, userIdType: "logged_in_user" }],
        queries: {
          exposure: [],
          identityJoins: [
            { ids: ["user_id", "anonymous_id"], query: "SELECT joins" },
          ],
        },
      },
    });

    expect(result.settings.queries?.identityJoins).toEqual([
      { ids: ["logged_in_user", "anonymous_id"], query: "SELECT joins" },
    ]);
  });

  it("does not let a client promote its own identifier type to managed", async () => {
    const result = await applyEventForwarderIdentifierTypeUpdates({
      context: context() as never,
      datasource: ds({ userIdTypes: [{ userIdType: "custom_id" }] }),
      settings: {
        userIdTypes: [
          {
            userIdType: "custom_id",
            managedBy: "api",
            sourceAttribute: "user_id",
          },
        ],
      },
    });

    expect(result.settings.userIdTypes).toEqual([{ userIdType: "custom_id" }]);
    expect(result.renames).toEqual([]);
  });

  it("does not let a client repoint a managed identifier type at another attribute", async () => {
    const result = await applyEventForwarderIdentifierTypeUpdates({
      context: context() as never,
      datasource: ds({ userIdTypes: [MANAGED_USER_ID] }),
      settings: {
        userIdTypes: [{ ...MANAGED_USER_ID, sourceAttribute: "company_id" }],
      },
    });

    expect(result.settings.userIdTypes?.[0].sourceAttribute).toBe("user_id");
  });

  it("leaves settings untouched when no identifier types are being saved", async () => {
    const settings = { queries: { exposure: [] } };
    const result = await applyEventForwarderIdentifierTypeUpdates({
      context: context() as never,
      datasource: ds({ userIdTypes: [MANAGED_USER_ID] }),
      settings,
    });

    expect(result.settings).toBe(settings);
    expect(result.renames).toEqual([]);
  });

  it("still renames identity joins when the datasource has no Event Forwarder", async () => {
    mockedGetEventForwarder.mockResolvedValue(null as never);

    const result = await applyEventForwarderIdentifierTypeUpdates({
      context: context() as never,
      datasource: ds({ userIdTypes: [MANAGED_USER_ID] }),
      settings: {
        userIdTypes: [{ ...MANAGED_USER_ID, userIdType: "logged_in_user" }],
        queries: { identityJoins: [{ ids: ["user_id"], query: "SELECT j" }] },
      },
    });

    expect(result.settings.queries?.identityJoins).toEqual([
      { ids: ["logged_in_user"], query: "SELECT j" },
    ]);
  });
});
