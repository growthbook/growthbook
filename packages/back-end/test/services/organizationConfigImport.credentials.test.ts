import { DataSourceInterface } from "shared/types/datasource";
import { DEFAULT_PERMISSION_ERROR_MESSAGE } from "shared/permissions";
import { ConfigFile } from "back-end/src/init/config";
import ClickHouse from "back-end/src/integrations/ClickHouse";
import { ReqContextClass } from "back-end/src/services/context";
import { encryptParams } from "back-end/src/services/datasource";
import {
  getContextForAgendaJobByOrgObject,
  importConfig,
} from "back-end/src/services/organizations";
import {
  getDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
  updateDataSource: jest.fn(),
}));

const storedParams = {
  url: "https://managed.example.invalid",
  port: 8443,
  username: "synthetic-managed-user",
  password: "synthetic-managed-password",
  database: "synthetic_database",
};
const context = (() => {
  // Datasource storage is mocked; retain real permissions without initializing Mongo models.
  const initializeModels = ReqContextClass.prototype["initModels"];
  try {
    ReqContextClass.prototype["initModels"] = jest.fn();
    return getContextForAgendaJobByOrgObject({
      id: "org_synthetic",
      name: "Import test",
      url: "import-test",
      dateCreated: new Date(),
      ownerEmail: "owner@example.invalid",
      members: [],
      invites: [],
    });
  } finally {
    ReqContextClass.prototype["initModels"] = initializeModels;
  }
})();

function importedConfig(type: "clickhouse" | "growthbook_clickhouse") {
  return {
    datasources: {
      warehouse: {
        name: "Warehouse",
        type,
        params: {
          url: "https://user-controlled.example.invalid",
          port: 8443,
          database: "synthetic_database",
          password: "",
        },
        settings: {},
        decryptionError: false,
      },
    },
  } satisfies ConfigFile;
}

describe("config import credential protection", () => {
  let datasource: DataSourceInterface;
  const query = jest.spyOn(ClickHouse.prototype, "runQuery");

  beforeEach(() => {
    jest.clearAllMocks();
    datasource = {
      id: "warehouse",
      organization: context.org.id,
      name: "Warehouse",
      type: "growthbook_clickhouse",
      params: encryptParams(storedParams),
      settings: {},
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    jest.mocked(getDataSourceById).mockResolvedValue(datasource);
    jest.mocked(updateDataSource).mockResolvedValue(datasource);
    query.mockResolvedValue({ rows: [] });
  });

  afterAll(() => jest.restoreAllMocks());

  it("rejects destination overrides on managed warehouses even for an admin", async () => {
    await expect(
      importConfig(context, importedConfig("growthbook_clickhouse")),
    ).rejects.toThrow(DEFAULT_PERMISSION_ERROR_MESSAGE);
    expect(query).not.toHaveBeenCalled();
    expect(updateDataSource).not.toHaveBeenCalled();
  });

  it("rejects changing a managed warehouse to an ordinary datasource before testing", async () => {
    await expect(
      importConfig(context, importedConfig("clickhouse")),
    ).rejects.toThrow("Cannot change the type");
    expect(query).not.toHaveBeenCalled();
    expect(updateDataSource).not.toHaveBeenCalled();
  });

  it("checks permissions before reusing customer-owned credentials", async () => {
    datasource.type = "clickhouse";
    jest
      .spyOn(context.permissions, "canUpdateDataSourceParams")
      .mockReturnValueOnce(false);
    await expect(
      importConfig(context, importedConfig("clickhouse")),
    ).rejects.toThrow(DEFAULT_PERMISSION_ERROR_MESSAGE);
    expect(query).not.toHaveBeenCalled();
    expect(updateDataSource).not.toHaveBeenCalled();
  });

  it("permits managed warehouse metadata updates without touching credentials", async () => {
    const config = importedConfig("growthbook_clickhouse");
    Reflect.deleteProperty(config.datasources.warehouse, "params");
    config.datasources.warehouse.name = "Renamed warehouse";
    await importConfig(context, config);
    expect(query).not.toHaveBeenCalled();
    expect(updateDataSource).toHaveBeenCalledWith(
      context,
      datasource,
      expect.objectContaining({
        name: "Renamed warehouse",
        params: datasource.params,
      }),
    );
  });

  it("still permits authorized updates to customer-owned connections", async () => {
    datasource.type = "clickhouse";
    const captured: unknown[] = [];
    query.mockImplementation(async function (this: ClickHouse) {
      captured.push({ ...this.params });
      return { rows: [] };
    });
    await importConfig(context, importedConfig("clickhouse"));
    expect(captured).toEqual([
      { ...storedParams, url: "https://user-controlled.example.invalid" },
    ]);
    expect(updateDataSource).toHaveBeenCalledTimes(1);
  });
});
