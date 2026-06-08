import { syncEventForwarderAfterAttributeSchemaChange } from "back-end/src/services/eventForwarderAttributeSync";
import * as EventForwarderConfig from "back-end/src/services/eventForwarderConfig";
import * as EventForwarderFactTable from "back-end/src/services/eventForwarderFactTable";
import * as EventForwarderUserIdTypes from "back-end/src/services/eventForwarderUserIdTypes";

jest.mock("back-end/src/services/eventForwarderConfig");
jest.mock("back-end/src/services/eventForwarderFactTable");
jest.mock("back-end/src/services/eventForwarderUserIdTypes");

const mockedHasAnyEventForwarderConfig =
  EventForwarderConfig.hasAnyEventForwarderConfig as jest.MockedFunction<
    typeof EventForwarderConfig.hasAnyEventForwarderConfig
  >;
const mockedSyncFactTable =
  EventForwarderFactTable.syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange as jest.MockedFunction<
    typeof EventForwarderFactTable.syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange
  >;
const mockedSyncAllUserIdTypes =
  EventForwarderUserIdTypes.syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema as jest.MockedFunction<
    typeof EventForwarderUserIdTypes.syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema
  >;
const mockedSyncHashMetadata =
  EventForwarderUserIdTypes.syncHashAttributeMetadataForEventForwarder as jest.MockedFunction<
    typeof EventForwarderUserIdTypes.syncHashAttributeMetadataForEventForwarder
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
    mockedSyncAllUserIdTypes.mockResolvedValue(undefined);
    mockedSyncHashMetadata.mockResolvedValue(undefined);
  });

  it("no-ops when event forwarder is not configured", async () => {
    mockedHasAnyEventForwarderConfig.mockResolvedValue(false);

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema: [],
      changeType: "create",
      after: { property: "id", datatype: "string", hashAttribute: true },
    });

    expect(mockedSyncAllUserIdTypes).not.toHaveBeenCalled();
    expect(mockedSyncFactTable).not.toHaveBeenCalled();
  });

  it("syncs userIdTypes and fact table metadata on hash attribute create", async () => {
    const attributeSchema = [
      { property: "user_id", datatype: "string" as const, hashAttribute: true },
    ];

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema,
      after: attributeSchema[0],
      changeType: "create",
    });

    expect(mockedSyncAllUserIdTypes).toHaveBeenCalledWith(
      expect.anything(),
      attributeSchema,
    );
    expect(mockedSyncFactTable).toHaveBeenCalledWith(
      expect.anything(),
      attributeSchema,
    );
  });

  it("syncs hash metadata when an existing hash attribute is renamed", async () => {
    const before = {
      property: "user_id",
      datatype: "string" as const,
      hashAttribute: true,
    };
    const after = {
      property: "account_id",
      datatype: "string" as const,
      hashAttribute: true,
    };

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema: [after],
      before,
      after,
      previousName: "user_id",
      changeType: "update",
    });

    expect(mockedSyncHashMetadata).toHaveBeenCalledWith(expect.anything(), {
      before,
      after,
      previousName: "user_id",
      attributeSchema: [after],
    });
    expect(mockedSyncFactTable).toHaveBeenCalled();
  });

  it("syncs hash metadata when hash attribute datatype changes", async () => {
    const before = {
      property: "user_id",
      datatype: "string" as const,
      hashAttribute: true,
    };
    const after = {
      property: "user_id",
      datatype: "number" as const,
      hashAttribute: true,
    };

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema: [after],
      before,
      after,
      changeType: "update",
    });

    expect(mockedSyncHashMetadata).toHaveBeenCalled();
    expect(mockedSyncFactTable).toHaveBeenCalled();
  });

  it("syncs fact table metadata when a regular attribute is renamed", async () => {
    const before = {
      property: "age",
      datatype: "number" as const,
    };
    const after = {
      property: "years_old",
      datatype: "number" as const,
    };

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema: [after],
      before,
      after,
      previousName: "age",
      changeType: "update",
    });

    expect(mockedSyncHashMetadata).not.toHaveBeenCalled();
    expect(mockedSyncFactTable).toHaveBeenCalledWith(expect.anything(), [
      after,
    ]);
  });

  it("syncs fact table metadata when a regular attribute datatype changes", async () => {
    const before = {
      property: "age",
      datatype: "string" as const,
    };
    const after = {
      property: "age",
      datatype: "number" as const,
    };

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema: [after],
      before,
      after,
      changeType: "update",
    });

    expect(mockedSyncHashMetadata).not.toHaveBeenCalled();
    expect(mockedSyncFactTable).toHaveBeenCalledWith(expect.anything(), [
      after,
    ]);
  });

  it("syncs fact table metadata on delete without userIdType sync", async () => {
    const before = {
      property: "age",
      datatype: "number" as const,
    };

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema: [],
      before,
      changeType: "delete",
    });

    expect(mockedSyncAllUserIdTypes).not.toHaveBeenCalled();
    expect(mockedSyncHashMetadata).not.toHaveBeenCalled();
    expect(mockedSyncFactTable).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("does not fail attribute flow when fact table sync throws", async () => {
    mockedSyncFactTable.mockRejectedValue(new Error("Cast to embedded failed"));

    await expect(
      syncEventForwarderAfterAttributeSchemaChange(context() as never, {
        attributeSchema: [{ property: "age", datatype: "number" }],
        after: { property: "age", datatype: "number" },
        changeType: "create",
      }),
    ).resolves.toBeUndefined();
  });

  it("skips fact table sync when only description changes", async () => {
    const before = { property: "age", datatype: "number" as const };
    const after = {
      property: "age",
      datatype: "number" as const,
      description: "updated",
    };

    await syncEventForwarderAfterAttributeSchemaChange(context() as never, {
      attributeSchema: [after],
      before,
      after,
      changeType: "update",
    });

    expect(mockedSyncFactTable).not.toHaveBeenCalled();
  });
});
