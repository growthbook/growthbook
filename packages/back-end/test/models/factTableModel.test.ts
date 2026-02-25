import { UpdateFactTableProps } from "shared/types/fact-table";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import { isAllowedApiManagedFactTableUpdate } from "../../src/models/FactTableModel";

type FactTableIdentity = {
  id: string;
  datasource: string;
};

describe("isAllowedApiManagedFactTableUpdate", () => {
  it("allows default API-managed update fields for non-managed-warehouse tables", () => {
    const factTable: FactTableIdentity = {
      id: "ftb_123",
      datasource: "ds_123",
    };
    const changes: UpdateFactTableProps = {
      columns: [],
      userIdTypes: ["user_id"],
    };

    expect(isAllowedApiManagedFactTableUpdate(factTable, changes)).toBeTruthy();
  });

  it("rejects columnsError for non-managed-warehouse tables", () => {
    const factTable: FactTableIdentity = {
      id: "ftb_123",
      datasource: "ds_123",
    };
    const changes: UpdateFactTableProps = {
      columns: [],
      columnsError: null,
    };

    expect(isAllowedApiManagedFactTableUpdate(factTable, changes)).toBeFalsy();
  });

  it(`allows managed warehouse ${MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID} refresh fields`, () => {
    const factTable: FactTableIdentity = {
      id: MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
      datasource: "managed_warehouse",
    };
    const changes: UpdateFactTableProps = {
      columns: [],
      userIdTypes: ["user_id"],
      columnsError: null,
      columnRefreshPending: false,
    };

    expect(isAllowedApiManagedFactTableUpdate(factTable, changes)).toBeTruthy();
  });

  it(`still rejects unrelated fields for managed warehouse ${MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID}`, () => {
    const factTable: FactTableIdentity = {
      id: MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
      datasource: "managed_warehouse",
    };
    const changes: UpdateFactTableProps = {
      name: "Updated Name",
    };

    expect(isAllowedApiManagedFactTableUpdate(factTable, changes)).toBeFalsy();
  });
});
