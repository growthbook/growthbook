import { syncEventForwarderAfterAttributeSchemaChange } from "back-end/src/services/eventForwarder/attributeSync";
import * as EventForwarderConfig from "back-end/src/services/eventForwarder/config";
import * as EventForwarderFactTable from "back-end/src/services/eventForwarder/factTable";
import * as EventForwarderUserIdTypes from "back-end/src/services/eventForwarder/datasourceSync";

jest.mock("back-end/src/services/eventForwarder/config");
jest.mock("back-end/src/services/eventForwarder/factTable");
jest.mock("back-end/src/services/eventForwarder/datasourceSync");

const mockedHasAnyEventForwarderConfig =
  EventForwarderConfig.hasAnyEventForwarderConfig as jest.MockedFunction<
    typeof EventForwarderConfig.hasAnyEventForwarderConfig
  >;
const mockedSyncFactTable =
  EventForwarderFactTable.syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange as jest.MockedFunction<
    typeof EventForwarderFactTable.syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange
  >;
const mockedReconcileDatasourceMetadata =
  EventForwarderUserIdTypes.reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries as jest.MockedFunction<
    typeof EventForwarderUserIdTypes.reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries
  >;

function context() {
  return {
    org: { id: "org1", settings: { attributeSchema: [] } },
  };
}

describe("syncEventForwarderAfterAttributeSchemaChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHasAnyEventForwarderConfig.mockResolvedValue(true);
    mockedSyncFactTable.mockResolvedValue(undefined);
    mockedReconcileDatasourceMetadata.mockResolvedValue(undefined);
  });

  it("no-ops when event forwarder is not configured", async () => {
    mockedHasAnyEventForwarderConfig.mockResolvedValue(false);

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema: [],
    });

    expect(mockedReconcileDatasourceMetadata).not.toHaveBeenCalled();
    expect(mockedSyncFactTable).not.toHaveBeenCalled();
  });

  it("reconciles datasource metadata and fact table metadata from the current attribute schema", async () => {
    const attributeSchema = [
      { property: "user_id", datatype: "string" as const, hashAttribute: true },
      { property: "age", datatype: "number" as const },
    ];

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema,
    });

    expect(mockedReconcileDatasourceMetadata).toHaveBeenCalledWith(
      expect.anything(),
      attributeSchema,
    );
    expect(mockedSyncFactTable).toHaveBeenCalledWith(
      expect.anything(),
      attributeSchema,
    );
  });

  it("still reconciles when only regular attributes changed", async () => {
    const attributeSchema = [{ property: "age", datatype: "number" as const }];

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema,
    });

    expect(mockedReconcileDatasourceMetadata).toHaveBeenCalledWith(
      expect.anything(),
      attributeSchema,
    );
    expect(mockedSyncFactTable).toHaveBeenCalledWith(
      expect.anything(),
      attributeSchema,
    );
  });

  it("does not fail attribute flow when datasource reconciliation throws", async () => {
    mockedReconcileDatasourceMetadata.mockRejectedValue(
      new Error("Datasource unavailable"),
    );

    await expect(
      syncEventForwarderAfterAttributeSchemaChange(context() as never, {
        attributeSchema: [{ property: "age", datatype: "number" }],
      }),
    ).resolves.toBeUndefined();
    expect(mockedSyncFactTable).toHaveBeenCalled();
  });

  it("does not fail attribute flow when fact table sync throws", async () => {
    mockedSyncFactTable.mockRejectedValue(new Error("Cast to embedded failed"));

    await expect(
      syncEventForwarderAfterAttributeSchemaChange(context() as never, {
        attributeSchema: [{ property: "age", datatype: "number" }],
      }),
    ).resolves.toBeUndefined();
  });
});
