import { getWarehouseErrorCode } from "back-end/src/util/integration";

describe("getWarehouseErrorCode", () => {
  it.each([
    [
      "BigQuery reason over HTTP status",
      { code: 404, errors: [{ reason: "notFound" }] },
      "notFound",
    ],
    [
      "Trino error name",
      { errorName: "TABLE_NOT_FOUND", errorCode: 46 },
      "TABLE_NOT_FOUND",
    ],
    [
      "Databricks SQLSTATE over its coarse state",
      { errorCode: "ERROR", response: { sqlState: "42P01" } },
      "42P01",
    ],
    [
      "Snowflake code over SQLSTATE",
      { code: "002003", sqlState: "42S02" },
      "002003",
    ],
    [
      "numeric codes as strings",
      Object.assign(new Error("x"), { code: 1301 }),
      "1301",
    ],
    ["plain errors", new Error("boom"), undefined],
    ["non-objects", "boom", undefined],
  ])("%s", (_label, error, expected) => {
    expect(getWarehouseErrorCode(error)).toBe(expected);
  });
});
