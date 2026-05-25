import { resumeEventForwarderThroughLicenseServer } from "back-end/src/services/eventForwarderProvisioning";
import {
  postResumeEventForwarderToLicenseServer,
  postUpdateEventForwarderSchemaToLicenseServer,
} from "back-end/src/enterprise/licenseUtil";
import { queueDelayedFactTableColumnsRefreshForDatasource } from "back-end/src/services/eventForwarderFactTable";

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
  queueDelayedFactTableColumnsRefreshForDatasource: jest.fn(),
  queueDelayedFactTableColumnsRefreshForEventForwarderDatasources: jest.fn(),
  queueEventForwarderEventsFactTablesColumnsRefresh: jest.fn(),
}));

const resumeRemoteMock =
  postResumeEventForwarderToLicenseServer as jest.MockedFunction<
    typeof postResumeEventForwarderToLicenseServer
  >;
const updateSchemaMock =
  postUpdateEventForwarderSchemaToLicenseServer as jest.MockedFunction<
    typeof postUpdateEventForwarderSchemaToLicenseServer
  >;
const queueRefreshMock =
  queueDelayedFactTableColumnsRefreshForDatasource as jest.MockedFunction<
    typeof queueDelayedFactTableColumnsRefreshForDatasource
  >;

describe("resumeEventForwarderThroughLicenseServer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resumeRemoteMock.mockResolvedValue({ ok: true });
    updateSchemaMock.mockResolvedValue({ schemaId: 10, schemaChanged: false });
    queueRefreshMock.mockResolvedValue(undefined);
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

  it("catches up schema on resume without refreshing fact tables when unchanged", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1", settings: { attributeSchema: [] } },
      models: { eventForwarderConfigs: { update } },
    } as never;

    await resumeEventForwarderThroughLicenseServer(context, config);

    expect(resumeRemoteMock).toHaveBeenCalled();
    expect(updateSchemaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org1",
        datasourceId: "ds_1",
        topic: "topic_1",
        schemaId: 10,
      }),
    );
    expect(queueRefreshMock).not.toHaveBeenCalled();
  });

  it("queues delayed fact table refresh when schema evolved on resume", async () => {
    updateSchemaMock.mockResolvedValue({ schemaId: 11, schemaChanged: true });
    const update = jest.fn().mockResolvedValue(undefined);
    const context = {
      org: { id: "org1", settings: { attributeSchema: [] } },
      models: { eventForwarderConfigs: { update } },
    } as never;

    await resumeEventForwarderThroughLicenseServer(context, config);

    expect(queueRefreshMock).toHaveBeenCalledWith(context, "ds_1");
  });
});
