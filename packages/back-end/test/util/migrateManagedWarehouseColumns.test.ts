import { MaterializedColumn } from "shared/types/datasource";
import { ColumnRef, FactTableColumnType } from "shared/types/fact-table";
import {
  buildMaterializedColumnJsonFields,
  buildMaterializedColumnRewriteMap,
  rewriteColumnRef,
  rewriteFactMetricColumns,
} from "back-end/src/util/migrateManagedWarehouseColumns";

const reserved = new Set(["geo_country", "url_path", "device_id"]);

function matCol(
  columnName: string,
  sourceField: string,
  type: MaterializedColumn["type"],
  datatype: FactTableColumnType = "string",
): MaterializedColumn {
  return { columnName, sourceField, datatype, type };
}

function columnRef(overrides: Partial<ColumnRef>): ColumnRef {
  return { factTableId: "ft", column: "$$count", ...overrides };
}

describe("buildMaterializedColumnRewriteMap", () => {
  it("maps non-identifier, non-reserved columns to attributes.<sourceField>", () => {
    const cols = [
      matCol("plan", "plan", "dimension"),
      matCol("region", "geo.region", ""),
    ];
    expect(buildMaterializedColumnRewriteMap(cols, reserved)).toEqual({
      plan: "attributes.plan",
      region: "attributes.geo.region",
    });
  });

  it("skips identifier columns (re-derived as SELECT-list aliases)", () => {
    const cols = [
      matCol("company_id", "company_id", "identifier"),
      matCol("plan", "plan", "dimension"),
    ];
    expect(buildMaterializedColumnRewriteMap(cols, reserved)).toEqual({
      plan: "attributes.plan",
    });
  });

  it("skips columns that collide with a reserved top-level column", () => {
    const cols = [
      matCol("geo_country", "geo_country", "dimension"),
      matCol("url_path", "url_path", ""),
    ];
    expect(buildMaterializedColumnRewriteMap(cols, reserved)).toEqual({});
  });

  it("matches reserved names case-insensitively", () => {
    const cols = [matCol("Geo_Country", "Geo_Country", "dimension")];
    expect(buildMaterializedColumnRewriteMap(cols, reserved)).toEqual({});
  });
});

describe("buildMaterializedColumnJsonFields", () => {
  it("maps non-identifier, non-reserved columns by sourceField, carrying datatype", () => {
    const cols = [
      matCol("plan", "plan", "dimension", "string"),
      matCol("age", "profile.age", "", "number"),
    ];
    expect(buildMaterializedColumnJsonFields(cols, reserved)).toEqual({
      plan: { datatype: "string" },
      "profile.age": { datatype: "number" },
    });
  });

  it("skips identifier and reserved-collision columns", () => {
    const cols = [
      matCol("company_id", "company_id", "identifier"),
      matCol("geo_country", "geo_country", "dimension"),
      matCol("plan", "plan", "dimension"),
    ];
    expect(buildMaterializedColumnJsonFields(cols, reserved)).toEqual({
      plan: { datatype: "string" },
    });
  });
});

describe("rewriteColumnRef", () => {
  const map = { plan: "attributes.plan" };

  it("rewrites the metric column", () => {
    const { columnRef: ref, changed } = rewriteColumnRef(
      columnRef({ column: "plan" }),
      map,
    );
    expect(changed).toBe(true);
    expect(ref.column).toBe("attributes.plan");
  });

  it("rewrites aggregateFilterColumn and rowFilter columns", () => {
    const { columnRef: ref, changed } = rewriteColumnRef(
      columnRef({
        column: "plan",
        aggregateFilterColumn: "plan",
        rowFilters: [
          { operator: "=", column: "plan", values: ["pro"] },
          { operator: ">", column: "geo_country", values: ["US"] },
        ],
      }),
      map,
    );
    expect(changed).toBe(true);
    expect(ref.aggregateFilterColumn).toBe("attributes.plan");
    expect(ref.rowFilters?.[0].column).toBe("attributes.plan");
    // unmapped row-filter column is left untouched
    expect(ref.rowFilters?.[1].column).toBe("geo_country");
  });

  it("leaves a ref with no matching columns unchanged", () => {
    const original = columnRef({
      column: "$$distinctUsers",
      rowFilters: [{ operator: ">", column: "geo_country", values: ["US"] }],
    });
    const { columnRef: ref, changed } = rewriteColumnRef(original, map);
    expect(changed).toBe(false);
    expect(ref).toEqual(original);
  });
});

describe("rewriteFactMetricColumns", () => {
  const map = { plan: "attributes.plan" };

  it("returns null when neither numerator nor denominator references a mapped column", () => {
    expect(
      rewriteFactMetricColumns(
        { numerator: columnRef({ column: "$$count" }), denominator: null },
        map,
      ),
    ).toBeNull();
  });

  it("rewrites the numerator and preserves a null denominator", () => {
    const result = rewriteFactMetricColumns(
      { numerator: columnRef({ column: "plan" }), denominator: null },
      map,
    );
    expect(result).not.toBeNull();
    expect(result?.numerator.column).toBe("attributes.plan");
    expect(result?.denominator).toBeNull();
  });

  it("rewrites the denominator when only it references a mapped column", () => {
    const result = rewriteFactMetricColumns(
      {
        numerator: columnRef({ column: "$$count" }),
        denominator: columnRef({ column: "plan" }),
      },
      map,
    );
    expect(result).not.toBeNull();
    expect(result?.numerator.column).toBe("$$count");
    expect(result?.denominator?.column).toBe("attributes.plan");
  });
});
