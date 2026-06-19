import type { DataSourceInterface } from "shared/types/datasource";
import type { EventForwarderConfigInterface } from "shared/validators";
import type { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { syncEventForwarderAfterDatasourceUpdate } from "back-end/src/services/eventForwarder/datasourceLifecycle";
import * as eventForwarderConfig from "back-end/src/services/eventForwarder/config";
import * as eventForwarderProvisioning from "back-end/src/services/eventForwarder/connector";

jest.mock("back-end/src/services/eventForwarder/config");
jest.mock("back-end/src/services/eventForwarder/connector");

const mockedGetEventForwarderForDatasource =
  eventForwarderConfig.getEventForwarderForDatasource as jest.MockedFunction<
    typeof eventForwarderConfig.getEventForwarderForDatasource
  >;
const mockedIsEventForwarderDraftUnchanged =
  eventForwarderConfig.isEventForwarderDraftUnchanged as jest.MockedFunction<
    typeof eventForwarderConfig.isEventForwarderDraftUnchanged
  >;
const mockedSyncEventForwarderConfigFromDatasource =
  eventForwarderConfig.syncEventForwarderConfigFromDatasource as jest.MockedFunction<
    typeof eventForwarderConfig.syncEventForwarderConfigFromDatasource
  >;
const mockedRefreshEventForwarderConfigCredentials =
  eventForwarderConfig.refreshEventForwarderConfigCredentials as jest.MockedFunction<
    typeof eventForwarderConfig.refreshEventForwarderConfigCredentials
  >;
const mockedProvisionEventForwarderThroughLicenseServer =
  eventForwarderProvisioning.provisionEventForwarderThroughLicenseServer as jest.MockedFunction<
    typeof eventForwarderProvisioning.provisionEventForwarderThroughLicenseServer
  >;
const mockedUpdateEventForwarderCredentialsThroughLicenseServer =
  eventForwarderProvisioning.updateEventForwarderCredentialsThroughLicenseServer as jest.MockedFunction<
    typeof eventForwarderProvisioning.updateEventForwarderCredentialsThroughLicenseServer
  >;

function datasource(): Pick<
  DataSourceInterface,
  "id" | "organization" | "projects" | "type"
> {
  return {
    id: "ds_1",
    organization: "org_1",
    projects: ["p1"],
    type: "bigquery",
  };
}

function draft(): EventForwarderConfigDraft {
  return {
    sinkType: "bigquery",
    config: {
      projectId: "my-project",
      dataset: "analytics",
      tablePrefix: "gb",
    },
  };
}

function existingConfig(): EventForwarderConfigInterface {
  return {
    id: "efc_1",
    organization: "org_1",
    datasourceId: "ds_1",
    projects: ["p1"],
    topic: "topic",
    schemaId: 1,
    sinkType: "bigquery",
    config: "encrypted",
    status: "ready",
    connectorName: "connector",
    connectorId: "connector-id",
    lastProvisioningError: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
}

describe("syncEventForwarderAfterDatasourceUpdate", () => {
  const context = {} as never;
  const datasourceParams = {} as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects datasource updates that try to remove the event forwarder", async () => {
    await expect(
      syncEventForwarderAfterDatasourceUpdate({
        context,
        datasource: datasource(),
        eventForwarderConfig: null,
        datasourceParams,
        didUpdateDatasourceParams: false,
      }),
    ).rejects.toThrow("Cannot remove an Event Forwarder via datasource update");
    expect(mockedGetEventForwarderForDatasource).not.toHaveBeenCalled();
  });

  it("skips provisioning when an explicit echoed draft is unchanged", async () => {
    const existing = existingConfig();
    mockedGetEventForwarderForDatasource.mockResolvedValue(existing);
    mockedIsEventForwarderDraftUnchanged.mockReturnValue(true);

    await syncEventForwarderAfterDatasourceUpdate({
      context,
      datasource: datasource(),
      eventForwarderConfig: draft(),
      datasourceParams,
      didUpdateDatasourceParams: false,
    });

    expect(mockedGetEventForwarderForDatasource).toHaveBeenCalledWith(
      context,
      "ds_1",
    );
    expect(mockedSyncEventForwarderConfigFromDatasource).not.toHaveBeenCalled();
    expect(
      mockedProvisionEventForwarderThroughLicenseServer,
    ).not.toHaveBeenCalled();
  });

  it("syncs and provisions when an explicit draft changes", async () => {
    const existing = existingConfig();
    const synced = { ...existing, status: "pending" as const };
    mockedGetEventForwarderForDatasource.mockResolvedValue(existing);
    mockedIsEventForwarderDraftUnchanged.mockReturnValue(false);
    mockedSyncEventForwarderConfigFromDatasource.mockResolvedValue(synced);

    await syncEventForwarderAfterDatasourceUpdate({
      context,
      datasource: datasource(),
      eventForwarderConfig: draft(),
      datasourceParams,
      didUpdateDatasourceParams: false,
    });

    expect(mockedSyncEventForwarderConfigFromDatasource).toHaveBeenCalledWith({
      context,
      datasource: datasource(),
      draft: draft(),
      datasourceParams,
    });
    expect(
      mockedProvisionEventForwarderThroughLicenseServer,
    ).toHaveBeenCalledWith(context, synced, datasourceParams, {
      restartAfterProvision: true,
    });
  });

  it("refreshes connector credentials when only datasource params changed", async () => {
    const refreshed = existingConfig();
    mockedRefreshEventForwarderConfigCredentials.mockResolvedValue(refreshed);

    await syncEventForwarderAfterDatasourceUpdate({
      context,
      datasource: datasource(),
      eventForwarderConfig: undefined,
      datasourceParams,
      didUpdateDatasourceParams: true,
    });

    expect(mockedRefreshEventForwarderConfigCredentials).toHaveBeenCalledWith(
      context,
      datasource(),
      datasourceParams,
    );
    expect(
      mockedUpdateEventForwarderCredentialsThroughLicenseServer,
    ).toHaveBeenCalledWith(context, refreshed, datasourceParams);
  });
});
