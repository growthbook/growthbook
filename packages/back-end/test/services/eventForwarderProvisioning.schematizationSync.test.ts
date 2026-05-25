import { syncEventForwarderSchematizationThroughLicenseServer } from "back-end/src/services/eventForwarderProvisioning";
import {
  postInitialEventForwarderSchematizationPingToLicenseServer,
  postUpdateEventForwarderSchemaToLicenseServer,
} from "back-end/src/enterprise/licenseUtil";
import { queueDelayedEventForwarderWarehouseSyncForDatasource } from "back-end/src/services/eventForwarderWarehouseSync";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: jest.fn(),
  postProvisionEventForwarderToLicenseServer: jest.fn(),
  postResumeEventForwarderToLicenseServer: jest.fn(),
  postTeardownEventForwarderToLicenseServer: jest.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: jest.fn(),
  postUpdateEventForwarderSchemaToLicenseServer: jest.fn(),
  postInitialEventForwarderSchematizationPingToLicenseServer: jest.fn(),
}));

jest.mock("back-end/src/services/eventForwarderWarehouseSync", () => ({
  queueDelayedEventForwarderWarehouseSyncForDatasource: jest.fn(),
}));

const updateSchemaMock =
  postUpdateEventForwarderSchemaToLicenseServer as jest.MockedFunction<
    typeof postUpdateEventForwarderSchemaToLicenseServer
  >;
const initialPingMock =
  postInitialEventForwarderSchematizationPingToLicenseServer as jest.MockedFunction<
    typeof postInitialEventForwarderSchematizationPingToLicenseServer
  >;
const warehouseSyncMock =
  queueDelayedEventForwarderWarehouseSyncForDatasource as jest.MockedFunction<
    typeof queueDelayedEventForwarderWarehouseSyncForDatasource
  >;

describe("syncEventForwarderSchematizationThroughLicenseServer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateSchemaMock.mockResolvedValue({ schemaId: 10, schemaChanged: false });
    initialPingMock.mockResolvedValue({ ok: true });
  });

  const config = {
    id: "efc_1",
    organization: "org1",
    datasourceId: "ds_1",
    sinkType: "bigquery" as const,
    connectorName: "connector_1",
    status: "ready" as const,
    topic: "gb-events-org1-ds1",
    schemaId: 10,
    config: "{}",
    projects: [],
  };

  it("evolves schema and always sends initial schematization ping", async () => {
    updateSchemaMock.mockResolvedValue({ schemaId: 11, schemaChanged: true });
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1", settings: { attributeSchema: [] } },
      models: {
        eventForwarderConfigs: {
          update,
          dangerousGetByDatasourceIdBypassPermission: jest
            .fn()
            .mockResolvedValue({ ...config, schemaId: 11 }),
        },
      },
    } as never;

    const result = await syncEventForwarderSchematizationThroughLicenseServer(
      context,
      config,
    );

    expect(updateSchemaMock).toHaveBeenCalled();
    expect(initialPingMock).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_1",
      topic: "gb-events-org1-ds1",
      schemaId: 11,
    });
    expect(result).toEqual({ schemaChanged: true, pingSent: true });
    expect(warehouseSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        org: expect.objectContaining({ id: "org1" }),
      }),
      "ds_1",
    );
  });

  it("still pings when schema is already up to date", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1", settings: { attributeSchema: [] } },
      models: {
        eventForwarderConfigs: {
          update,
          dangerousGetByDatasourceIdBypassPermission: jest
            .fn()
            .mockResolvedValue(config),
        },
      },
    } as never;

    const result = await syncEventForwarderSchematizationThroughLicenseServer(
      context,
      config,
    );

    expect(result).toEqual({ schemaChanged: false, pingSent: true });
    expect(initialPingMock).toHaveBeenCalled();
  });

  it("throws when forwarder is not ready", async () => {
    await expect(
      syncEventForwarderSchematizationThroughLicenseServer({} as never, {
        ...config,
        status: "paused",
      }),
    ).rejects.toThrow("Only ready event forwarders can sync schematization");
  });
});
