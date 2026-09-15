import { pauseEventForwarderThroughLicenseServer } from "back-end/src/services/eventForwarder/connector";
import { postPauseEventForwarderToLicenseServer } from "back-end/src/enterprise/licenseUtil";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: jest.fn(),
  postProvisionEventForwarderToLicenseServer: jest.fn(),
  postResumeEventForwarderToLicenseServer: jest.fn(),
  postTeardownEventForwarderToLicenseServer: jest.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: jest.fn(),
}));

describe("pauseEventForwarderThroughLicenseServer", () => {
  const pauseRemoteMock =
    postPauseEventForwarderToLicenseServer as jest.MockedFunction<
      typeof postPauseEventForwarderToLicenseServer
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    pauseRemoteMock.mockResolvedValue(undefined);
  });

  it("calls license server and updates config when ready", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1" },
      throwPlanDoesNotAllowError: (message: string): never => {
        throw new Error(message);
      },
      models: {
        eventForwarderConfigs: {
          update,
        },
      },
    } as never;

    await pauseEventForwarderThroughLicenseServer(context, {
      id: "ef_2",
      organization: "org1",
      datasourceId: "ds_2",
      sinkType: "bigquery",
      connectorName: "connector_2",
      status: "ready",
      topic: "topic_2",
      schemaId: 2,
      config: "{}",
      projects: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });

    expect(pauseRemoteMock).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_2",
      connectorName: "connector_2",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ef_2" }),
      expect.objectContaining({ status: "paused" }),
    );
  });
});
