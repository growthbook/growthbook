import {
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
