import { MockedFunction, vi } from "vitest";
import { resumeEventForwarderThroughLicenseServer } from "back-end/src/services/eventForwarder/connector";
import { postResumeEventForwarderToLicenseServer } from "back-end/src/enterprise/licenseUtil";

vi.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: vi.fn(),
  postProvisionEventForwarderToLicenseServer: vi.fn(),
  postResumeEventForwarderToLicenseServer: vi.fn(),
  postTeardownEventForwarderToLicenseServer: vi.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: vi.fn(),
}));

vi.mock("back-end/src/services/eventForwarder/factTable", () => ({
  ensureEventForwarderEventsFactTable: vi.fn(),
  queueDelayedFactTableColumnsRefreshForDatasource: vi.fn(),
}));

const resumeRemoteMock =
  postResumeEventForwarderToLicenseServer as MockedFunction<
    typeof postResumeEventForwarderToLicenseServer
  >;

describe("resumeEventForwarderThroughLicenseServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const update = vi.fn().mockResolvedValue(undefined);
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
