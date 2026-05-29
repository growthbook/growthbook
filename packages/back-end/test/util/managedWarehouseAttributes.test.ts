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

  describe("matcol__ prefix on user attributes", () => {
    it("sets physicalColumnName=matcol__<property> for unaliased user attributes", () => {
      const cols = getWarehouseMaterializedColumns([
        attr({ property: "tier", datatype: "string", hashAttribute: true }),
      ]);
      const tier = cols.find((c) => c.columnName === "tier");
      expect(tier).toMatchObject({
        physicalColumnName: "matcol__tier",
      });
    });

    it("leaves built-in columns without a physicalColumnName (CH stores them under their bare name)", () => {
      // The fact-table-SQL generator uses `physicalColumnName ?? columnName`,
      // so absent on built-ins means "no alias needed".
      const cols = getWarehouseMaterializedColumns([]);
      for (const builtin of ["user_id", "utm_source", "geo_country"]) {
        const c = cols.find((col) => col.columnName === builtin);
        expect(c?.physicalColumnName).toBeUndefined();
      }
    });

    it("prefixes attribute-shadowed built-ins (user `url` attr replaces builtin `url`)", () => {
      // When an attribute shares its exact name with a built-in, the
      // attribute wins — and is physically stored as `matcol__url`.
      const cols = getWarehouseMaterializedColumns([
        attr({ property: "url", datatype: "string" }),
      ]);
      const urlCols = cols.filter((c) => c.columnName === "url");
      expect(urlCols).toHaveLength(1);
      expect(urlCols[0].physicalColumnName).toBe("matcol__url");
    });
  });

  describe("SDK-alias shadow", () => {
    it("skips materializing utmSource and promotes the utm_source builtin to identifier when hashAttribute", () => {
      // Documents the SDK auto-wrapper double-write: targeting on `utmSource`
      // shouldn't add a second column when the ingestor already writes
      // `utm_source` as a top-level field with the same value.
      const cols = getWarehouseMaterializedColumns([
        attr({
          property: "utmSource",
          datatype: "string",
          hashAttribute: true,
        }),
      ]);
      expect(cols.find((c) => c.columnName === "utmSource")).toBeUndefined();
      expect(cols.find((c) => c.columnName === "utm_source")).toMatchObject({
        type: "identifier",
      });
    });

    it("keeps the builtin as a dimension when the aliased attribute has no hashAttribute", () => {
      const cols = getWarehouseMaterializedColumns([
        attr({ property: "utmCampaign", datatype: "string" }),
      ]);
      expect(cols.find((c) => c.columnName === "utmCampaign")).toBeUndefined();
      expect(cols.find((c) => c.columnName === "utm_campaign")).toMatchObject({
        type: "dimension",
      });
    });

    it("aliases the default 'id' attribute to the user_id builtin and promotes it to identifier", () => {
      // Default-org case: the seeded `id` attribute (hashAttribute:true) should
      // shadow the `user_id` builtin rather than create a separate column.
      const cols = getWarehouseMaterializedColumns([
        attr({ property: "id", datatype: "string", hashAttribute: true }),
      ]);
      expect(cols.find((c) => c.columnName === "id")).toBeUndefined();
      expect(cols.find((c) => c.columnName === "user_id")).toMatchObject({
        type: "identifier",
      });
    });

    it("doesn't shadow when the attribute is array-typed (no built-in is an array)", () => {
      // An (unusual) attribute named `utmSource` declared as string[] still
      // materializes — the built-in is scalar so it can't carry the data.
      const cols = getWarehouseMaterializedColumns([
        attr({ property: "utmSource", datatype: "string[]" }),
      ]);
      expect(cols.find((c) => c.columnName === "utmSource")).toMatchObject({
        arrayElementType: "string",
        type: "dimension",
      });
      // The built-in stays too — both columns exist because the user's
      // attribute is genuinely different data.
      expect(cols.find((c) => c.columnName === "utm_source")).toMatchObject({
        type: "dimension",
      });
    });

    it("applies multiple aliased attributes independently and leaves unaliased attributes alone", () => {
      const cols = getWarehouseMaterializedColumns([
        attr({ property: "utmSource", datatype: "string" }),
        attr({ property: "browser", datatype: "enum" }),
        attr({ property: "tier", datatype: "string", hashAttribute: true }),
      ]);
      // Both aliased attrs are shadowed — only their built-ins remain.
      expect(cols.find((c) => c.columnName === "utmSource")).toBeUndefined();
      expect(cols.find((c) => c.columnName === "browser")).toBeUndefined();
      expect(cols.find((c) => c.columnName === "utm_source")).toBeDefined();
      expect(cols.find((c) => c.columnName === "ua_browser")).toBeDefined();
      // The unaliased attr materializes normally.
      expect(cols.find((c) => c.columnName === "tier")).toMatchObject({
        type: "identifier",
        datatype: "string",
      });
    });

    it("preserves an aliased attribute when its column already exists in the snapshot", () => {
      // Regression coverage for the customer who manually added `utmSource`
      // as a warehouse column (e.g. their non-JS SDK populated only the
      // camelCase variant). On first sync we must NOT shadow it into the
      // utm_source builtin — historical data lives in the utmSource column,
      // and the builtin may be empty for this customer.
      const cols = getWarehouseMaterializedColumns(
        [attr({ property: "utmSource", datatype: "string" })],
        { existingColumnNames: new Set(["utmSource"]) },
      );
      // Attribute is materialized (with prefix on the physical column).
      expect(cols.find((c) => c.columnName === "utmSource")).toMatchObject({
        physicalColumnName: "matcol__utmSource",
        type: "dimension",
      });
      // Builtin still present alongside — both columns coexist for this org.
      expect(cols.find((c) => c.columnName === "utm_source")).toBeDefined();
    });

    it("still shadows aliased attributes whose columns are NOT in the snapshot", () => {
      // Same alias map, same attribute, but the snapshot doesn't have a
      // utmSource column → safe to shadow (no historical data to lose).
      const cols = getWarehouseMaterializedColumns(
        [attr({ property: "utmSource", datatype: "string" })],
        { existingColumnNames: new Set(["something_else"]) },
      );
      expect(cols.find((c) => c.columnName === "utmSource")).toBeUndefined();
      expect(cols.find((c) => c.columnName === "utm_source")).toMatchObject({
        type: "dimension",
      });
    });

    it("preserves a legacy Key-Attributes column where the SDK property is in sourceField, not columnName", () => {
      // Pre-refactor scenario: Key Attributes UI let customers pick a custom
      // CH columnName. The snapshot then has e.g.
      //   { sourceField: "utmSource", columnName: "custom_utm" }
      // The set must include `sourceField` values too — keying on columnName
      // alone would miss this and shadow the attribute, dropping the user's
      // custom_utm column on first sync. The LS-side caller builds this set
      // as the union of both fields; this test pins that contract.
      const cols = getWarehouseMaterializedColumns(
        [attr({ property: "utmSource", datatype: "string" })],
        { existingColumnNames: new Set(["custom_utm", "utmSource"]) },
      );
      // Attribute materializes (the override path applies the legacy
      // columnName + opts out of the prefix on the LS side; the GB seed
      // doesn't apply overrides so the bare prefixed form is fine here).
      expect(cols.find((c) => c.columnName === "utmSource")).toMatchObject({
        physicalColumnName: "matcol__utmSource",
      });
      // Builtin still present — both columns coexist.
      expect(cols.find((c) => c.columnName === "utm_source")).toBeDefined();
    });
  });
});
