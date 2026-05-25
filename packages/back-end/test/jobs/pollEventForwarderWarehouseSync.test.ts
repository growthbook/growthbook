import { buildEventForwarderWarehouseSyncExpectation } from "back-end/src/jobs/pollEventForwarderWarehouseSync";

describe("buildEventForwarderWarehouseSyncExpectation", () => {
  it("uses initial expectation for initial ping", () => {
    expect(
      buildEventForwarderWarehouseSyncExpectation({
        pingKind: "initial",
        schemaChanged: false,
      }),
    ).toEqual({ kind: "initial" });
  });

  it("uses columnsAdded when schema changed on manual sync", () => {
    expect(
      buildEventForwarderWarehouseSyncExpectation({
        pingKind: "manual",
        schemaChanged: true,
        newColumnNames: ["plan"],
      }),
    ).toEqual({ kind: "columnsAdded", columnNames: ["plan"] });
  });

  it("returns null when schema unchanged on manual sync", () => {
    expect(
      buildEventForwarderWarehouseSyncExpectation({
        pingKind: "manual",
        schemaChanged: false,
      }),
    ).toBeNull();
  });
});
