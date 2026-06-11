import { resumeEventForwarderThroughLicenseServer } from "back-end/src/services/eventForwarder/connector";
import { postResumeEventForwarderToLicenseServer } from "back-end/src/enterprise/licenseUtil";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: jest.fn(),
  postProvisionEventForwarderToLicenseServer: jest.fn(),
  postResumeEventForwarderToLicenseServer: jest.fn(),
  postTeardownEventForwarderToLicenseServer: jest.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: jest.fn(),
}));

jest.mock("back-end/src/services/eventForwarder/factTable", () => ({
  ensureEventForwarderEventsFactTable: jest.fn(),
  queueDelayedFactTableColumnsRefreshForDatasource: jest.fn(),
}));

const resumeRemoteMock =
  postResumeEventForwarderToLicenseServer as jest.MockedFunction<
    typeof postResumeEventForwarderToLicenseServer
  >;

describe("resumeEventForwarderThroughLicenseServer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resumeRemoteMock.mockResolvedValue({ ok: true });
  });

  const config = {
    id: "efc_1",
    organization: "org1",
    datasourceId: "ds_1",
    sinkType: "bigquery" as const,
    connectorName: "connector_1",
    status: "paused" as const,
    topic: "topic_1",
    schemaId: 10,
    config: "{}",
    projects: [],
  };

  it("calls license server and marks config ready", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1", settings: { attributeSchema: [] } },
      models: { eventForwarderConfigs: { update } },
    } as never;

    await resumeEventForwarderThroughLicenseServer(context, config);

    expect(resumeRemoteMock).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "efc_1",
      }),
      expect.objectContaining({
        status: "ready",
        lastProvisioningError: "",
      }),
    );
  });
});
