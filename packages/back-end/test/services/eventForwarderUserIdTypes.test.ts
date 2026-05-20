import type { DataSourceInterface } from "shared/types/datasource";
import {
  initializeDatasourceUserIdTypesFromOrgAttributeSchema,
  syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema,
} from "back-end/src/services/eventForwarderUserIdTypes";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";

jest.mock("back-end/src/models/DataSourceModel");

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
  });

  it("skips when raw Mongo already has userIdTypes", async () => {
    mockedGetRaw.mockResolvedValue(
      ds("ds_1", {
        userIdTypes: [{ userIdType: "user_id", description: "" }],
      }),
    );

    await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
      contextWithSchema([
        { property: "id", datatype: "string", hashAttribute: true },
      ]) as never,
      "ds_1",
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
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
});

describe("syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
