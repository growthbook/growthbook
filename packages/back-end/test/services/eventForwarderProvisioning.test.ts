import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { DataSourceInterface } from "shared/types/datasource";
import { provisionEventForwarderThroughLicenseServer } from "back-end/src/services/eventForwarderProvisioning";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { postProvisionEventForwarderToLicenseServer } from "back-end/src/enterprise/licenseUtil";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarderConfig";
import { resolveBigQueryEventForwarderTableName } from "back-end/src/services/eventForwarderBqTableResolution";
import { testEventForwarderWriteAccess } from "back-end/src/services/eventForwarderWriteAccessValidation";
import { ensureEventForwarderBigQueryTables } from "back-end/src/services/eventForwarderBqTables";
import { initializeDatasourceUserIdTypesFromOrgAttributeSchema } from "back-end/src/services/eventForwarderUserIdTypes";
import { ensureEventForwarderFeatureUsageQuery } from "back-end/src/services/eventForwarderFeatureUsageQueries";
import { ensureEventForwarderEventsFactTable } from "back-end/src/services/eventForwarderFactTable";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postPauseEventForwarderToLicenseServer: jest.fn(),
  postProvisionEventForwarderToLicenseServer: jest.fn(),
  postRestartEventForwarderToLicenseServer: jest.fn(),
  postResumeEventForwarderToLicenseServer: jest.fn(),
  postTeardownEventForwarderToLicenseServer: jest.fn(),
  postUpdateEventForwarderCredentialsToLicenseServer: jest.fn(),
}));
jest.mock("back-end/src/services/eventForwarderConfig");
jest.mock("back-end/src/services/eventForwarderBqTableResolution");
jest.mock("back-end/src/services/eventForwarderWriteAccessValidation");
jest.mock("back-end/src/services/eventForwarderBqTables");
jest.mock("back-end/src/services/eventForwarderUserIdTypes");
jest.mock("back-end/src/services/eventForwarderFeatureUsageQueries");
jest.mock("back-end/src/services/eventForwarderFactTable");

const mockedGetDataSourceById = getDataSourceById as jest.MockedFunction<
  typeof getDataSourceById
>;
const mockedProvisionRemote =
  postProvisionEventForwarderToLicenseServer as jest.MockedFunction<
    typeof postProvisionEventForwarderToLicenseServer
  >;
const mockedDecrypt = decryptEventForwarderConfigModel as jest.MockedFunction<
  typeof decryptEventForwarderConfigModel
>;
const mockedResolveBigQueryTableName =
  resolveBigQueryEventForwarderTableName as jest.MockedFunction<
    typeof resolveBigQueryEventForwarderTableName
  >;
const mockedWriteAccess = testEventForwarderWriteAccess as jest.MockedFunction<
  typeof testEventForwarderWriteAccess
>;
const mockedEnsureBigQueryTables =
  ensureEventForwarderBigQueryTables as jest.MockedFunction<
    typeof ensureEventForwarderBigQueryTables
  >;
const mockedInitializeUserIdTypes =
  initializeDatasourceUserIdTypesFromOrgAttributeSchema as jest.MockedFunction<
    typeof initializeDatasourceUserIdTypesFromOrgAttributeSchema
  >;
const mockedEnsureFeatureUsage =
  ensureEventForwarderFeatureUsageQuery as jest.MockedFunction<
    typeof ensureEventForwarderFeatureUsageQuery
  >;
const mockedEnsureFactTable =
  ensureEventForwarderEventsFactTable as jest.MockedFunction<
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
    jest.clearAllMocks();
    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tableName: "gb_events",
      serviceAccountKey: "{}",
    });
    mockedResolveBigQueryTableName.mockResolvedValue("gb_events");
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
    mockedInitializeUserIdTypes.mockResolvedValue({
      identifierTypes: ["user_id"],
      exposureQueryIds: ["user_id"],
      featureUsageQueryIds: [],
    });
    mockedEnsureFeatureUsage.mockResolvedValue(["fuq_1"]);
    mockedEnsureFactTable.mockResolvedValue("ds_1_events");
  });

  it("stores managed resource ids on the event forwarder config", async () => {
    const update = jest.fn(async (existing, updates) => ({
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

    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "efc_1",
      }),
      {
        managedResources: {
          identifierTypes: ["user_id"],
          exposureQueryIds: ["user_id"],
          featureUsageQueryIds: ["fuq_1"],
          factTableId: "ds_1_events",
        },
      },
    );
  });
});
