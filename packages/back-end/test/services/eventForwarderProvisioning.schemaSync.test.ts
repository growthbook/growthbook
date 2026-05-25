import { syncEventForwarderSchemasAfterAttributeSchemaChange } from "back-end/src/services/eventForwarderProvisioning";
import { postUpdateEventForwarderSchemaToLicenseServer } from "back-end/src/enterprise/licenseUtil";
import { queueEventForwarderWarehouseSync } from "back-end/src/jobs/pollEventForwarderWarehouseSync";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: jest.fn(),
  postProvisionEventForwarderToLicenseServer: jest.fn(),
  postResumeEventForwarderToLicenseServer: jest.fn(),
  postTeardownEventForwarderToLicenseServer: jest.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: jest.fn(),
  postUpdateEventForwarderSchemaToLicenseServer: jest.fn(),
}));

jest.mock("back-end/src/jobs/pollEventForwarderWarehouseSync", () => ({
  queueEventForwarderWarehouseSync: jest.fn(),
}));

describe("syncEventForwarderSchemasAfterAttributeSchemaChange", () => {
  const updateSchemaMock =
    postUpdateEventForwarderSchemaToLicenseServer as jest.MockedFunction<
      typeof postUpdateEventForwarderSchemaToLicenseServer
    >;
  const warehouseSyncMock =
    queueEventForwarderWarehouseSync as jest.MockedFunction<
      typeof queueEventForwarderWarehouseSync
    >;
  beforeEach(() => {
    jest.clearAllMocks();
    updateSchemaMock.mockResolvedValue({
      schemaId: 99,
      schemaChanged: true,
      newFieldNames: ["country"],
    });
    warehouseSyncMock.mockResolvedValue(undefined);
  });

  it("queues warehouse sync poll when any forwarder schema changed", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1", settings: { attributeSchema: [] } },
      models: {
        eventForwarderConfigs: {
          getAll: jest.fn().mockResolvedValue([
            {
              id: "ef_1",
              organization: "org1",
              datasourceId: "ds_1",
              sinkType: "bigquery",
              status: "ready",
              topic: "topic_1",
              schemaId: 1,
            },
          ]),
          update,
        },
      },
    } as never;

    await syncEventForwarderSchemasAfterAttributeSchemaChange(context, [
      { property: "country", datatype: "string" },
    ]);

    expect(updateSchemaMock).toHaveBeenCalled();
    expect(warehouseSyncMock).toHaveBeenCalledWith(context, "ds_1", {
      pingKind: "manual",
      schemaChanged: true,
      newColumnNames: ["country"],
    });
  });

  it("skips warehouse sync when no forwarder schema changed", async () => {
    updateSchemaMock.mockResolvedValue({
      schemaId: 1,
      schemaChanged: false,
      newFieldNames: [],
    });
    const context = {
      org: { id: "org1", settings: { attributeSchema: [] } },
      models: {
        eventForwarderConfigs: {
          getAll: jest.fn().mockResolvedValue([
            {
              id: "ef_1",
              organization: "org1",
              datasourceId: "ds_1",
              sinkType: "bigquery",
              status: "ready",
              topic: "topic_1",
              schemaId: 1,
            },
          ]),
          update: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as never;

    await syncEventForwarderSchemasAfterAttributeSchemaChange(context, [
      { property: "country", datatype: "string" },
    ]);

    expect(warehouseSyncMock).not.toHaveBeenCalled();
  });
});
