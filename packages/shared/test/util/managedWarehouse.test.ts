import type { MaterializedColumn } from "../../types/datasource";
import {
  buildManagedWarehouseFactTableSQL,
  isManagedWarehouseNoEventsGuidanceMessage,
  isManagedWarehousePendingQueryError,
  MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE,
  MANAGED_WAREHOUSE_PENDING_ERROR_CODE,
  MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL,
} from "../../src/util/managedWarehouse";

describe("isManagedWarehousePendingQueryError", () => {
  it("matches the bare error code", () => {
    expect(
      isManagedWarehousePendingQueryError(MANAGED_WAREHOUSE_PENDING_ERROR_CODE),
    ).toBe(true);
  });

  it("matches when the code is appended (e.g. QueryRunner analysis prefix)", () => {
    expect(
      isManagedWarehousePendingQueryError(
        `Error running analysis: ${MANAGED_WAREHOUSE_PENDING_ERROR_CODE}`,
      ),
    ).toBe(true);
  });

  it("returns false for empty and unrelated messages", () => {
    expect(isManagedWarehousePendingQueryError("")).toBe(false);
    expect(isManagedWarehousePendingQueryError(undefined)).toBe(false);
    expect(isManagedWarehousePendingQueryError(null)).toBe(false);
    expect(isManagedWarehousePendingQueryError("Connection refused")).toBe(
      false,
    );
  });
});

describe("isManagedWarehouseNoEventsGuidanceMessage", () => {
  it("matches pending code and legacy long copy", () => {
    expect(
      isManagedWarehouseNoEventsGuidanceMessage(
        MANAGED_WAREHOUSE_PENDING_ERROR_CODE,
      ),
    ).toBe(true);
    expect(
      isManagedWarehouseNoEventsGuidanceMessage(
        `${MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE} Read our full docs (${MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL}) with instructions.`,
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isManagedWarehouseNoEventsGuidanceMessage("")).toBe(false);
    expect(isManagedWarehouseNoEventsGuidanceMessage(undefined)).toBe(false);
    expect(isManagedWarehouseNoEventsGuidanceMessage("No tables found.")).toBe(
      false,
    );
  });
});

describe("buildManagedWarehouseFactTableSQL", () => {
  const col = (overrides: Partial<MaterializedColumn>): MaterializedColumn => ({
    columnName: "x",
    sourceField: "x",
    datatype: "string",
    type: "dimension",
    ...overrides,
  });

  it("emits an explicit alias only when physical name differs from logical", () => {
    const sql = buildManagedWarehouseFactTableSQL([
      // User attribute → aliased
      col({
        columnName: "tier",
        sourceField: "tier",
        physicalColumnName: "matcol__tier",
      }),
      // Built-in → no alias (physical falls back to columnName)
      col({ columnName: "utm_source", sourceField: "utm_source" }),
    ]);
    expect(sql).toContain("matcol__tier as tier");
    expect(sql).toContain("utm_source");
    expect(sql).not.toContain("utm_source as utm_source");
  });

  it("treats absent physicalColumnName as 'physical equals logical' (legacy snapshot)", () => {
    // Legacy snapshots persisted before the prefix landed don't carry
    // `physicalColumnName`. The SELECT must still be valid CH SQL.
    const sql = buildManagedWarehouseFactTableSQL([
      col({ columnName: "tier", sourceField: "tier" }),
    ]);
    expect(sql).toContain("tier");
    expect(sql).not.toContain("matcol__");
  });

  it("includes the base event columns regardless of materialized-column set", () => {
    const sql = buildManagedWarehouseFactTableSQL([]);
    for (const name of [
      "timestamp",
      "client_key",
      "event_name",
      "properties",
      "attributes",
      "environment",
      "sdk_language",
      "sdk_version",
      "event_uuid",
      "ip",
    ]) {
      expect(sql).toContain(name);
    }
    expect(sql).toContain("FROM events");
    expect(sql).toContain("{{startDate}}");
    expect(sql).toContain("{{endDate}}");
  });

  it("is deterministic across column orderings (sorted by logical name)", () => {
    const sqlA = buildManagedWarehouseFactTableSQL([
      col({
        columnName: "tier",
        sourceField: "tier",
        physicalColumnName: "matcol__tier",
      }),
      col({
        columnName: "alpha",
        sourceField: "alpha",
        physicalColumnName: "matcol__alpha",
      }),
    ]);
    const sqlB = buildManagedWarehouseFactTableSQL([
      col({
        columnName: "alpha",
        sourceField: "alpha",
        physicalColumnName: "matcol__alpha",
      }),
      col({
        columnName: "tier",
        sourceField: "tier",
        physicalColumnName: "matcol__tier",
      }),
    ]);
    expect(sqlA).toEqual(sqlB);
    // Confirm ordering — alpha comes before tier in the projection list.
    expect(sqlA.indexOf("matcol__alpha")).toBeLessThan(
      sqlA.indexOf("matcol__tier"),
    );
  });

  it("skips materialized columns whose logical name collides with a base column", () => {
    // Defensive: an attribute named `timestamp` should never land in the
    // materialized column set (validation rejects it), but if a buggy
    // snapshot still contained one, the SELECT must not list it twice.
    const sql = buildManagedWarehouseFactTableSQL([
      col({
        columnName: "timestamp",
        sourceField: "timestamp",
        physicalColumnName: "matcol__timestamp",
      }),
    ]);
    expect(sql).not.toContain("matcol__timestamp");
    // The base `timestamp` is still there.
    expect(sql).toContain("timestamp");
  });
});
