import type { DataSourceInterface } from "shared/types/datasource";
import {
  initializeDatasourceUserIdTypesFromOrgAttributeSchema,
  syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema,
} from "back-end/src/services/eventForwarderUserIdTypes";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderExposureQueries from "back-end/src/services/eventForwarderExposureQueries";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/services/eventForwarderExposureQueries");

const mockedEnsureExposure =
  EventForwarderExposureQueries.ensureEventForwarderExposureQueries as jest.MockedFunction<
    typeof EventForwarderExposureQueries.ensureEventForwarderExposureQueries
  >;

const mockedGetRaw =
  DataSourceModel.getRawDataSourceById as jest.MockedFunction<
    typeof DataSourceModel.getRawDataSourceById
  >;
const mockedGetById = DataSourceModel.getDataSourceById as jest.MockedFunction<
  typeof DataSourceModel.getDataSourceById
>;
const mockedUpdate = DataSourceModel.updateDataSource as jest.MockedFunction<
  typeof DataSourceModel.updateDataSource
>;

function ds(
  id: string,
  settings: DataSourceInterface["settings"] = {},
): DataSourceInterface {
  return {
    id,
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

function contextWithSchema(
  schema: { property: string; datatype: "string"; hashAttribute?: boolean }[],
) {
  return {
    org: {
      id: "org1",
      settings: { attributeSchema: schema },
    },
    models: {
      eventForwarderConfigs: {
        getAll: jest.fn(),
      },
    },
  };
}

describe("initializeDatasourceUserIdTypesFromOrgAttributeSchema", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnsureExposure.mockResolvedValue(undefined);
  });

  it("merges hash attributes without overriding existing names (case insensitive)", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [{ userIdType: "user_id", description: "Existing" }],
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);

    await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
      contextWithSchema([
        { property: "USER_ID", datatype: "string", hashAttribute: true },
        { property: "id", datatype: "string", hashAttribute: true },
      ]) as never,
      "ds_1",
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        settings: {
          userIdTypes: [
            { userIdType: "user_id", description: "Existing" },
            {
              userIdType: "id",
              description: "",
              attributes: ["id"],
            },
          ],
        },
      },
    );
  });

  it("writes userIdTypes when raw Mongo has none", async () => {
    const raw = ds("ds_1", {});
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue({ ...raw, settings: {} });

    await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
      contextWithSchema([
        { property: "id", datatype: "string", hashAttribute: true },
        { property: "country", datatype: "string" },
      ]) as never,
      "ds_1",
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        settings: {
          userIdTypes: [
            {
              userIdType: "id",
              description: "",
              attributes: ["id"],
            },
          ],
        },
      },
    );
  });

  it("ensures exposure queries when event forwarder config is provided", async () => {
    const raw = ds("ds_1", {});
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);

    const config = {
      id: "efc_1",
      datasourceId: "ds_1",
      sinkType: "bigquery" as const,
      config: "encrypted",
      status: "pending" as const,
      organization: "org1",
      projects: [],
      topic: "topic",
    };

    await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
      contextWithSchema([
        { property: "id", datatype: "string", hashAttribute: true },
      ]) as never,
      "ds_1",
      config,
    );

    expect(mockedEnsureExposure).toHaveBeenCalledWith(
      expect.anything(),
      config,
      ["id"],
    );
  });
});

describe("syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnsureExposure.mockResolvedValue(undefined);
  });

  it("merges new hash attributes into all event forwarder datasources", async () => {
    const getAll = jest
      .fn()
      .mockResolvedValue([{ datasourceId: "ds_a" }, { datasourceId: "ds_b" }]);

    mockedGetRaw
      .mockResolvedValueOnce(
        ds("ds_a", {
          userIdTypes: [
            { userIdType: "id", description: "", attributes: ["id"] },
          ],
        }),
      )
      .mockResolvedValueOnce(ds("ds_b", { userIdTypes: [] }));

    mockedGetById
      .mockResolvedValueOnce(ds("ds_a"))
      .mockResolvedValueOnce(ds("ds_b"));

    const attributeSchema = [
      { property: "id", datatype: "string" as const, hashAttribute: true },
      {
        property: "device_id",
        datatype: "string" as const,
        hashAttribute: true,
      },
    ];

    await syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
      {
        org: { id: "org1" },
        models: { eventForwarderConfigs: { getAll } },
      } as never,
      attributeSchema,
    );

    expect(mockedUpdate).toHaveBeenCalledTimes(2);
    expect(mockedEnsureExposure).toHaveBeenCalledTimes(2);
    expect(mockedEnsureExposure).toHaveBeenCalledWith(
      expect.anything(),
      { datasourceId: "ds_a" },
      ["device_id"],
    );
    expect(mockedEnsureExposure).toHaveBeenCalledWith(
      expect.anything(),
      { datasourceId: "ds_b" },
      ["id", "device_id"],
    );
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ds_a" }),
      {
        settings: {
          userIdTypes: [
            { userIdType: "id", description: "", attributes: ["id"] },
            {
              userIdType: "device_id",
              description: "",
              attributes: ["device_id"],
            },
          ],
        },
      },
    );
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ds_b" }),
      {
        settings: {
          userIdTypes: [
            {
              userIdType: "id",
              description: "",
              attributes: ["id"],
            },
            {
              userIdType: "device_id",
              description: "",
              attributes: ["device_id"],
            },
          ],
        },
      },
    );
  });

  it("does nothing when no event forwarder configs exist", async () => {
    const getAll = jest.fn().mockResolvedValue([]);

    await syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
      {
        org: { id: "org1" },
        models: { eventForwarderConfigs: { getAll } },
      } as never,
      [{ property: "id", datatype: "string", hashAttribute: true }],
    );

    expect(mockedGetRaw).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
