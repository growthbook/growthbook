import {
  buildEventForwarderStatusResponse,
  mapLicenseConnectorPhaseToEventForwarderStatus,
  syncEventForwarderStatusFromLicenseServer,
} from "back-end/src/services/eventForwarderConnectorStatusSync";
import {
  postEventForwarderStatusToLicenseServer,
  postInitialEventForwarderSchematizationPingToLicenseServer,
} from "back-end/src/enterprise/licenseUtil";
import { queueEventForwarderWarehouseSync } from "back-end/src/jobs/pollEventForwarderWarehouseSync";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postEventForwarderStatusToLicenseServer: jest.fn(),
  postInitialEventForwarderSchematizationPingToLicenseServer: jest.fn(),
}));

jest.mock("back-end/src/jobs/pollEventForwarderWarehouseSync", () => ({
  queueEventForwarderWarehouseSync: jest.fn(),
}));

const statusMock =
  postEventForwarderStatusToLicenseServer as jest.MockedFunction<
    typeof postEventForwarderStatusToLicenseServer
  >;
const initialPingMock =
  postInitialEventForwarderSchematizationPingToLicenseServer as jest.MockedFunction<
    typeof postInitialEventForwarderSchematizationPingToLicenseServer
  >;
const warehouseSyncMock =
  queueEventForwarderWarehouseSync as jest.MockedFunction<
    typeof queueEventForwarderWarehouseSync
  >;

function efConfig(
  overrides: Partial<{
    status: string;
    initialGbUpdatePingSent: boolean;
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
    initialGbUpdatePingSent: undefined,
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
    initialPingMock.mockResolvedValue({ ok: true });
  });

  it("sends initial schematization ping when connector becomes ready", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1" },
      models: { eventForwarderConfigs: { update } },
    } as never;
    const config = efConfig();

    await syncEventForwarderStatusFromLicenseServer(context, config as never);

    expect(initialPingMock).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_1",
      topic: "gb-events-org1-ds1",
      schemaId: 10,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "efc_1" }),
      expect.objectContaining({ initialGbUpdatePingSent: true }),
    );
    expect(warehouseSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        org: expect.objectContaining({ id: "org1" }),
      }),
      "ds_1",
      { pingKind: "initial", schemaChanged: false },
    );
  });

  it("skips initial ping when already sent", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1" },
      models: { eventForwarderConfigs: { update } },
    } as never;

    await syncEventForwarderStatusFromLicenseServer(
      context,
      efConfig({ status: "ready", initialGbUpdatePingSent: true }) as never,
    );

    expect(initialPingMock).not.toHaveBeenCalled();
  });

  it("does not set initialGbUpdatePingSent when ping fails", async () => {
    initialPingMock.mockRejectedValue(new Error("kafka down"));
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
      expect.objectContaining({ initialGbUpdatePingSent: true }),
    );
  });
});
