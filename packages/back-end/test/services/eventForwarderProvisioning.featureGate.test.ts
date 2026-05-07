import {
  pauseEventForwarderThroughLicenseServer,
  teardownBigQueryEventForwarderInfrastructureRemote,
} from "back-end/src/services/eventForwarderProvisioning";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  postPauseEventForwarderToLicenseServer,
  postTeardownEventForwarderToLicenseServer,
} from "back-end/src/enterprise/licenseUtil";

jest.mock("back-end/src/enterprise", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: jest.fn(),
  postProvisionEventForwarderToLicenseServer: jest.fn(),
  postResumeEventForwarderToLicenseServer: jest.fn(),
  postTeardownEventForwarderToLicenseServer: jest.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: jest.fn(),
  postUpdateEventForwarderSchemaToLicenseServer: jest.fn(),
}));

describe("eventForwarderProvisioning feature gate", () => {
  const orgHasPremiumFeatureMock = orgHasPremiumFeature as jest.MockedFunction<
    typeof orgHasPremiumFeature
  >;
  const pauseRemoteMock =
    postPauseEventForwarderToLicenseServer as jest.MockedFunction<
      typeof postPauseEventForwarderToLicenseServer
    >;
  const teardownRemoteMock =
    postTeardownEventForwarderToLicenseServer as jest.MockedFunction<
      typeof postTeardownEventForwarderToLicenseServer
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    orgHasPremiumFeatureMock.mockReturnValue(true);
    pauseRemoteMock.mockResolvedValue(undefined);
    teardownRemoteMock.mockResolvedValue(undefined);
  });

  it("blocks pause when events-forwarder feature is disabled", async () => {
    const context = {
      org: { id: "org1" },
      throwPlanDoesNotAllowError: (message: string): never => {
        throw new Error(message);
      },
      models: {
        eventForwarderConfigs: {
          update: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as never;
    orgHasPremiumFeatureMock.mockReturnValue(false);

    await expect(
      pauseEventForwarderThroughLicenseServer(context, {
        id: "ef_1",
        organization: "org1",
        datasourceId: "ds_1",
        sinkType: "bigquery",
        connectorName: "connector_1",
        status: "ready",
        topic: "topic_1",
        schemaId: 1,
        config: "{}",
        projects: [],
        dateCreated: new Date(),
        dateUpdated: new Date(),
      }),
    ).rejects.toThrow("Event Forwarder is not enabled for this organization.");

    expect(pauseRemoteMock).not.toHaveBeenCalled();
  });

  it("allows pause when events-forwarder feature is enabled", async () => {
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

  it("blocks teardown when events-forwarder feature is disabled", async () => {
    const context = {
      org: { id: "org1" },
      throwPlanDoesNotAllowError: (message: string): never => {
        throw new Error(message);
      },
    } as never;
    orgHasPremiumFeatureMock.mockReturnValue(false);

    await expect(
      teardownBigQueryEventForwarderInfrastructureRemote({
        context,
        snapshot: {
          organizationId: "org1",
          datasourceId: "ds_3",
          sinkType: "bigquery",
          topic: "topic_3",
        },
      }),
    ).rejects.toThrow("Event Forwarder is not enabled for this organization.");

    expect(teardownRemoteMock).not.toHaveBeenCalled();
  });
});
