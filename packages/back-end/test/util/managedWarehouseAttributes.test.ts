import type { SDKAttribute } from "shared/types/organization";
import { getWarehouseMaterializedColumns } from "back-end/src/util/managedWarehouseAttributes";

jest.mock("back-end/src/util/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const attr = (
  overrides: Partial<SDKAttribute> &
    Pick<SDKAttribute, "property" | "datatype">,
): SDKAttribute => ({
  ...overrides,
});

describe("getWarehouseMaterializedColumns", () => {
  it("treats enum + hashAttribute as an identifier (parity with string)", () => {
    const cols = getWarehouseMaterializedColumns([
      attr({ property: "tier", datatype: "enum", hashAttribute: true }),
    ]);
    const tier = cols.find((c) => c.columnName === "tier");
    expect(tier).toMatchObject({ datatype: "string", type: "identifier" });
  });

  it("never marks array attributes as identifiers, even with hashAttribute", () => {
    const cols = getWarehouseMaterializedColumns([
      attr({ property: "tags", datatype: "string[]", hashAttribute: true }),
    ]);
    const tags = cols.find((c) => c.columnName === "tags");
    expect(tags).toMatchObject({
      datatype: "string",
      arrayElementType: "string",
      type: "dimension",
    });
  });

  it("maps number[] to a number column with arrayElementType=number", () => {
    const cols = getWarehouseMaterializedColumns([
      attr({ property: "scores", datatype: "number[]" }),
    ]);
    expect(cols.find((c) => c.columnName === "scores")).toMatchObject({
      datatype: "number",
      arrayElementType: "number",
    });
  });

  it("skips secureString attributes — materializing them would defeat the hash", () => {
    const cols = getWarehouseMaterializedColumns([
      attr({ property: "ssn", datatype: "secureString" }),
      attr({ property: "phones", datatype: "secureString[]" }),
    ]);
    expect(cols.find((c) => c.columnName === "ssn")).toBeUndefined();
    expect(cols.find((c) => c.columnName === "phones")).toBeUndefined();
  });

  it("skips archived attributes", () => {
    const cols = getWarehouseMaterializedColumns([
      attr({ property: "old_attr", datatype: "string", archived: true }),
    ]);
    expect(cols.find((c) => c.columnName === "old_attr")).toBeUndefined();
  });

  it("skips attributes whose property isn't a legal ClickHouse identifier", () => {
    const cols = getWarehouseMaterializedColumns([
      attr({ property: "$groups", datatype: "string" }),
      attr({ property: "valid_name", datatype: "string" }),
    ]);
    expect(cols.find((c) => c.columnName === "$groups")).toBeUndefined();
    expect(cols.find((c) => c.columnName === "valid_name")).toBeDefined();
  });

  it("lets an attribute shadow a built-in column of the same name (no duplicate)", () => {
    const cols = getWarehouseMaterializedColumns([
      attr({ property: "user_id", datatype: "string", hashAttribute: true }),
    ]);
    const userIdCols = cols.filter((c) => c.columnName === "user_id");
    expect(userIdCols).toHaveLength(1);
    // Attribute-driven entry, so it carries identifier semantics from hashAttribute.
    expect(userIdCols[0]).toMatchObject({ type: "identifier" });
  });

  it("includes built-in columns that aren't shadowed by attributes", () => {
    const cols = getWarehouseMaterializedColumns([]);
    expect(cols.find((c) => c.columnName === "user_id")).toBeDefined();
    expect(cols.find((c) => c.columnName === "url_path")).toBeDefined();
    expect(cols.find((c) => c.columnName === "geo_lat")).toMatchObject({
      datatype: "number",
    });
  });
});
