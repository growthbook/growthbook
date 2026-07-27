import {
  buildEventForwarderStatusResponse,
  mapLicenseConnectorPhaseToEventForwarderStatus,
  syncEventForwarderStatusFromLicenseServer,
} from "back-end/src/services/eventForwarder/connector";
import { postEventForwarderStatusToLicenseServer } from "back-end/src/enterprise/licenseUtil";
import { queueDelayedEventForwarderWarehouseSyncForDatasource } from "back-end/src/services/eventForwarder/warehouseSync";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postEventForwarderStatusToLicenseServer: jest.fn(),
}));

jest.mock("back-end/src/services/eventForwarder/warehouseSync", () => ({
  queueDelayedEventForwarderWarehouseSyncForDatasource: jest.fn(),
}));

const statusMock =
  postEventForwarderStatusToLicenseServer as jest.MockedFunction<
    typeof postEventForwarderStatusToLicenseServer
  >;
const warehouseSyncMock =
  queueDelayedEventForwarderWarehouseSyncForDatasource as jest.MockedFunction<
    typeof queueDelayedEventForwarderWarehouseSyncForDatasource
  >;

function efConfig(
  overrides: Partial<{
    status: string;
    initialWarehouseSyncQueued: boolean;
  }> = {},
) {
  return {
    id: "efc_1",
    organization: "org1",
    datasourceId: "ds_1",
    sinkType: "bigquery" as const,
    config: "encrypted",
    status: "pending" as const,
    projects: [],
    topic: "gb-events-org1-ds1",
    schemaId: 10,
    connectorName: "connector_1",
    initialWarehouseSyncQueued: undefined,
    ...overrides,
  };
}

describe("mapLicenseConnectorPhaseToEventForwarderStatus", () => {
  it("maps provisioning to pending", () => {
    expect(mapLicenseConnectorPhaseToEventForwarderStatus("provisioning")).toBe(
      "pending",
    );
  });

  it("maps ready to ready", () => {
    expect(mapLicenseConnectorPhaseToEventForwarderStatus("ready")).toBe(
      "ready",
    );
  });

  it("maps error to error", () => {
    expect(mapLicenseConnectorPhaseToEventForwarderStatus("error")).toBe(
      "error",
    );
  });
});

describe("buildEventForwarderStatusResponse", () => {
  it("includes message, confluent state, and task errors from license server", () => {
    const response = buildEventForwarderStatusResponse({
      confluentState: "FAILED",
      phase: "error",
      message: "Task failed",
      taskErrors: [
        {
          id: 0,
          state: "USER_ACTIONABLE_ERROR",
          trace: "snowflake.url.name: Cannot connect",
        },
      ],
    });
    expect(response.status).toBe("error");
    expect(response.phase).toBe("error");
    expect(response.message).toBe("Task failed");
    expect(response.confluentState).toBe("FAILED");
    expect(response.taskErrors).toHaveLength(1);
  });
});

describe("syncEventForwarderStatusFromLicenseServer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    statusMock.mockResolvedValue({
      confluentState: "RUNNING",
      phase: "ready",
    });
    warehouseSyncMock.mockResolvedValue(undefined);
  });

  it("queues initial warehouse sync when connector becomes ready", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1" },
      models: { eventForwarderConfigs: { update } },
    } as never;
    const config = efConfig();

    await syncEventForwarderStatusFromLicenseServer(context, config as never);

    expect(warehouseSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        org: expect.objectContaining({ id: "org1" }),
      }),
      "ds_1",
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "efc_1" }),
      expect.objectContaining({ initialWarehouseSyncQueued: true }),
    );
  });

  it("skips initial warehouse sync when already queued", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1" },
      models: { eventForwarderConfigs: { update } },
    } as never;

    await syncEventForwarderStatusFromLicenseServer(
      context,
      efConfig({ status: "ready", initialWarehouseSyncQueued: true }) as never,
    );

    expect(warehouseSyncMock).not.toHaveBeenCalled();
  });

  it("does not set initialWarehouseSyncQueued when queue fails", async () => {
    warehouseSyncMock.mockRejectedValue(new Error("queue failed"));
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1" },
      models: { eventForwarderConfigs: { update } },
    } as never;

    await syncEventForwarderStatusFromLicenseServer(
      context,
      efConfig() as never,
    );

    expect(update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initialWarehouseSyncQueued: true }),
    );
  });
});
