import { MockedFunction, vi } from "vitest";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { DataSourceInterface } from "shared/types/datasource";
import { provisionEventForwarderThroughLicenseServer } from "back-end/src/services/eventForwarder/connector";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { postProvisionEventForwarderToLicenseServer } from "back-end/src/enterprise/licenseUtil";
import {
  decryptEventForwarderConfigModel,
  getBigQueryEventForwarderProjectId,
} from "back-end/src/services/eventForwarder/config";
import {
  resolveBigQueryEventForwarderTablePrefix,
  ensureEventForwarderBigQueryTables,
} from "back-end/src/services/eventForwarder/bigquery";
import { testEventForwarderWriteAccess } from "back-end/src/services/eventForwarder/writeAccess";
import { reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries } from "back-end/src/services/eventForwarder/datasourceSync";
import { ensureEventForwarderFeatureUsageQuery } from "back-end/src/services/eventForwarder/datasourceQueries";
import { ensureEventForwarderEventsFactTable } from "back-end/src/services/eventForwarder/factTable";

vi.mock("back-end/src/models/DataSourceModel");
vi.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: vi.fn(),
  postProvisionEventForwarderToLicenseServer: vi.fn(),
  postRestartEventForwarderToLicenseServer: vi.fn(),
  postResumeEventForwarderToLicenseServer: vi.fn(),
  postTeardownEventForwarderToLicenseServer: vi.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: vi.fn(),
}));
vi.mock("back-end/src/services/eventForwarder/config");
vi.mock("back-end/src/services/eventForwarder/bigquery");
vi.mock("back-end/src/services/eventForwarder/writeAccess");
vi.mock("back-end/src/services/eventForwarder/datasourceSync");
vi.mock("back-end/src/services/eventForwarder/datasourceQueries");
vi.mock("back-end/src/services/eventForwarder/factTable");

const mockedGetDataSourceById = getDataSourceById as MockedFunction<
  typeof getDataSourceById
>;
const mockedProvisionRemote =
  postProvisionEventForwarderToLicenseServer as MockedFunction<
    typeof postProvisionEventForwarderToLicenseServer
  >;
const mockedDecrypt = decryptEventForwarderConfigModel as MockedFunction<
  typeof decryptEventForwarderConfigModel
>;
const mockedGetBigQueryProjectId =
  getBigQueryEventForwarderProjectId as MockedFunction<
    typeof getBigQueryEventForwarderProjectId
  >;
const mockedResolveBigQueryTablePrefix =
  resolveBigQueryEventForwarderTablePrefix as MockedFunction<
    typeof resolveBigQueryEventForwarderTablePrefix
  >;
const mockedWriteAccess = testEventForwarderWriteAccess as MockedFunction<
  typeof testEventForwarderWriteAccess
>;
const mockedEnsureBigQueryTables =
  ensureEventForwarderBigQueryTables as MockedFunction<
    typeof ensureEventForwarderBigQueryTables
  >;
const mockedReconcileUserIdTypes =
  reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries as MockedFunction<
    typeof reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries
  >;
const mockedEnsureFeatureUsage =
  ensureEventForwarderFeatureUsageQuery as MockedFunction<
    typeof ensureEventForwarderFeatureUsageQuery
  >;
const mockedEnsureFactTable =
  ensureEventForwarderEventsFactTable as MockedFunction<
    typeof ensureEventForwarderEventsFactTable
  >;

function datasource(): DataSourceInterface {
  return {
    id: "ds_1",
    organization: "org1",
    name: "Production Analytics",
    type: "bigquery",
    description: "",
    params: {
      defaultProject: "my-project",
      defaultDataset: "analytics_123",
    } as DataSourceInterface["params"],
    settings: {},
    projects: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
}

describe("provisionEventForwarderThroughLicenseServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });
    mockedGetBigQueryProjectId.mockReturnValue("my-project");
    mockedResolveBigQueryTablePrefix.mockResolvedValue("gb");
    mockedWriteAccess.mockResolvedValue({
      results: {
        sinkWrite: { result: "success" },
      },
    } as never);
    mockedEnsureBigQueryTables.mockResolvedValue(undefined);
    mockedProvisionRemote.mockResolvedValue({
      schemaId: 12,
      connectorName: "connector_1",
      connectorId: "connector-id-1",
    });
    mockedReconcileUserIdTypes.mockResolvedValue(undefined);
    mockedEnsureFeatureUsage.mockResolvedValue(["fuq_1"]);
    mockedEnsureFactTable.mockResolvedValue("ds_1_events");
  });

  it("creates managed datasource resources without storing resource ids on the event forwarder config", async () => {
    const update = vi.fn(async (existing, updates) => ({
      ...existing,
      ...updates,
    }));
    const context = {
      org: {
        id: "org1",
        settings: {
          attributeSchema: [
            { property: "user_id", datatype: "string", hashAttribute: true },
          ],
        },
      },
      models: {
        eventForwarderConfigs: {
          update,
        },
      },
    };
    const config = {
      id: "efc_1",
      organization: "org1",
      datasourceId: "ds_1",
      projects: [],
      topic: "topic_1",
      schemaId: 0,
      sinkType: "bigquery" as const,
      config: "encrypted",
      status: "pending" as const,
      connectorName: "",
      connectorId: "",
      lastProvisioningError: "",
    };

    await provisionEventForwarderThroughLicenseServer(
      context as never,
      config,
      { defaultProject: "my-project" } as BigQueryConnectionParams,
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(config, {
      schemaId: 12,
      status: "pending",
      connectorName: "connector_1",
      connectorId: "connector-id-1",
      lastProvisioningError: "",
    });
    expect(mockedReconcileUserIdTypes).toHaveBeenCalled();
    expect(mockedEnsureFeatureUsage).toHaveBeenCalled();
    expect(mockedEnsureFactTable).toHaveBeenCalled();
  });
});
