import {
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import { updateFactTable } from "../../src/models/FactTableModel";

describe("updateFactTable", () => {
  const factTable: FactTableInterface = {
    organization: "org_123",
    id: "ftb_123",
    managedBy: "api",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Fact Table",
    description: "",
    owner: "owner",
    projects: [],
    tags: [],
    datasource: "ds_123",
    userIdTypes: [],
    sql: "SELECT 1",
    eventName: "",
    columns: [],
    filters: [],
  };

  const getContext = () => {
    const canUpdateFactTable = jest.fn().mockReturnValue(false);
    const throwPermissionError = jest.fn(() => {
      throw new Error("permission denied");
    });

    const context = {
      permissions: {
        canUpdateFactTable,
        throwPermissionError,
      },
    } as unknown as ReqContext;

    return { context, canUpdateFactTable };
  };

  it("allows columns-only changes for API-managed tables", async () => {
    const changes: UpdateFactTableProps = {
      columns: [],
    };
    const { context, canUpdateFactTable } = getContext();

    await expect(updateFactTable(context, factTable, changes)).rejects.toThrow(
      "permission denied",
    );
    expect(canUpdateFactTable).toHaveBeenCalledWith(factTable, changes);
  });

  it("rejects columnsError (system side-effect, not user-specified)", async () => {
    const changes: UpdateFactTableProps = {
      columns: [],
      columnsError: null,
    };
    const { context, canUpdateFactTable } = getContext();

    await expect(updateFactTable(context, factTable, changes)).rejects.toThrow(
      "Cannot update fact table managed by API if the request isn't from the API.",
    );
    expect(canUpdateFactTable).not.toHaveBeenCalled();
  });

  it("rejects userIdTypes (system side-effect, not user-specified)", async () => {
    const changes: UpdateFactTableProps = {
      columns: [],
      userIdTypes: ["user_id"],
    };
    const { context, canUpdateFactTable } = getContext();

    await expect(updateFactTable(context, factTable, changes)).rejects.toThrow(
      "Cannot update fact table managed by API if the request isn't from the API.",
    );
    expect(canUpdateFactTable).not.toHaveBeenCalled();
  });

  it("rejects unrelated fields like name", async () => {
    const changes: UpdateFactTableProps = {
      name: "Updated Name",
    };
    const { context, canUpdateFactTable } = getContext();

    await expect(updateFactTable(context, factTable, changes)).rejects.toThrow(
      "Cannot update fact table managed by API if the request isn't from the API.",
    );
    expect(canUpdateFactTable).not.toHaveBeenCalled();
  });
});
