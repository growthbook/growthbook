import { restartEventForwarderThroughLicenseServer } from "back-end/src/services/eventForwarder/connector";
import { postRestartEventForwarderToLicenseServer } from "back-end/src/enterprise/licenseUtil";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postRestartEventForwarderToLicenseServer: jest.fn(),
}));

jest.mock("back-end/src/services/eventForwarder/factTable", () => ({
  ensureEventForwarderEventsFactTable: jest.fn(),
  queueDelayedFactTableColumnsRefreshForDatasource: jest.fn(),
}));

const restartRemoteMock =
  postRestartEventForwarderToLicenseServer as jest.MockedFunction<
    typeof postRestartEventForwarderToLicenseServer
  >;

describe("restartEventForwarderThroughLicenseServer", () => {
  const config = {
    id: "efc_1",
    organization: "org1",
    datasourceId: "ds_1",
    sinkType: "databricks" as const,
    connectorName: "ds_1",
    status: "error" as const,
    lastProvisioningError: "Failed to create stream",
    topic: "event_forwarder_databricks",
    schemaId: 0,
    config: "{}",
    projects: [],
  };

  const makeContext = (update: jest.Mock) =>
    ({
      org: { id: "org1" },
      models: { eventForwarderConfigs: { update } },
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    restartRemoteMock.mockResolvedValue({ ok: true });
  });

  it("restarts through the license server and re-polls from pending", async () => {
    const update = jest.fn().mockResolvedValue(undefined);

    await restartEventForwarderThroughLicenseServer(
      makeContext(update),
      config,
    );

    expect(restartRemoteMock).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_1",
      connectorName: "ds_1",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "efc_1" }),
      { status: "pending", lastProvisioningError: "" },
    );
  });

  it("restarts a ready in-house forwarder so a stopped replay can finish", async () => {
    const update = jest.fn().mockResolvedValue(undefined);

    await restartEventForwarderThroughLicenseServer(makeContext(update), {
      ...config,
      status: "ready",
    });

    expect(restartRemoteMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "a paused forwarder", overrides: { status: "paused" as const } },
    {
      name: "a ready forwarder on a Confluent connector",
      overrides: { status: "ready" as const, topic: "gb-events-org1-ds_1" },
    },
  ])("rejects $name", async ({ overrides }) => {
    const update = jest.fn();

    await expect(
      restartEventForwarderThroughLicenseServer(makeContext(update), {
        ...config,
        ...overrides,
      }),
    ).rejects.toThrow("Only errored event forwarders can be restarted");
    expect(restartRemoteMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves the error in place when the license server call fails", async () => {
    const update = jest.fn();
    restartRemoteMock.mockRejectedValue(new Error("license server down"));

    await expect(
      restartEventForwarderThroughLicenseServer(makeContext(update), config),
    ).rejects.toThrow("license server down");
    expect(update).not.toHaveBeenCalled();
  });
});
