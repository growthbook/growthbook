import { syncEventForwarderSchemasAfterAttributeSchemaChange } from "back-end/src/services/eventForwarderProvisioning";
import { postUpdateEventForwarderSchemaToLicenseServer } from "back-end/src/enterprise/licenseUtil";
import { queueDelayedFactTableColumnsRefreshForEventForwarderDatasources } from "back-end/src/services/eventForwarderFactTable";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: jest.fn(),
  postProvisionEventForwarderToLicenseServer: jest.fn(),
  postResumeEventForwarderToLicenseServer: jest.fn(),
  postTeardownEventForwarderToLicenseServer: jest.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: jest.fn(),
  postUpdateEventForwarderSchemaToLicenseServer: jest.fn(),
}));

jest.mock("back-end/src/services/eventForwarderFactTable", () => ({
  ensureEventForwarderEventsFactTable: jest.fn(),
  queueDelayedFactTableColumnsRefreshForEventForwarderDatasources: jest.fn(),
  queueEventForwarderEventsFactTablesColumnsRefresh: jest.fn(),
}));

describe("syncEventForwarderSchemasAfterAttributeSchemaChange", () => {
  const updateSchemaMock =
    postUpdateEventForwarderSchemaToLicenseServer as jest.MockedFunction<
      typeof postUpdateEventForwarderSchemaToLicenseServer
    >;
  const queueDelayedMock =
    queueDelayedFactTableColumnsRefreshForEventForwarderDatasources as jest.MockedFunction<
      typeof queueDelayedFactTableColumnsRefreshForEventForwarderDatasources
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    updateSchemaMock.mockResolvedValue({ schemaId: 99, schemaChanged: true });
    queueDelayedMock.mockResolvedValue(undefined);
  });

  it("queues delayed refresh when any forwarder schema changed", async () => {
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
    expect(queueDelayedMock).toHaveBeenCalledWith(context);
  });

  it("skips delayed refresh when no forwarder schema changed", async () => {
    updateSchemaMock.mockResolvedValue({ schemaId: 1, schemaChanged: false });
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

    expect(queueDelayedMock).not.toHaveBeenCalled();
  });
});
