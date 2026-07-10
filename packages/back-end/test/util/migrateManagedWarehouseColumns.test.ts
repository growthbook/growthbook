import { MaterializedColumn } from "shared/types/datasource";
import { FactTableColumnType } from "shared/types/fact-table";
import { getMigratedDimensionColumns } from "back-end/src/util/migrateManagedWarehouseColumns";

const reserved = new Set(["geo_country", "url_path", "device_id"]);

function matCol(
  columnName: string,
  sourceField: string,
  type: MaterializedColumn["type"],
  datatype: FactTableColumnType = "string",
): MaterializedColumn {
  return { columnName, sourceField, datatype, type };
}

describe("getMigratedDimensionColumns", () => {
  it("keeps non-identifier, non-reserved columns (preserving sourceField + datatype)", () => {
    const cols = [
      matCol("plan", "plan", "dimension", "string"),
      matCol("age", "profile.age", "", "number"),
    ];
    expect(getMigratedDimensionColumns(cols, reserved)).toEqual([
      matCol("plan", "plan", "dimension", "string"),
      matCol("age", "profile.age", "", "number"),
    ]);
  });

  it("drops identifier columns (preserved separately as join-key aliases)", () => {
    const cols = [
      matCol("company_id", "company_id", "identifier"),
      matCol("plan", "plan", "dimension"),
    ];
    expect(getMigratedDimensionColumns(cols, reserved)).toEqual([
      matCol("plan", "plan", "dimension"),
    ]);
  });

  it("drops columns that collide with a reserved top-level column", () => {
    const cols = [
      matCol("geo_country", "geo_country", "dimension"),
      matCol("url_path", "url_path", ""),
      matCol("plan", "plan", "dimension"),
    ];
    expect(getMigratedDimensionColumns(cols, reserved)).toEqual([
      matCol("plan", "plan", "dimension"),
    ]);
  });

  it("matches reserved names case-insensitively", () => {
    const cols = [matCol("Geo_Country", "Geo_Country", "dimension")];
    expect(getMigratedDimensionColumns(cols, reserved)).toEqual([]);
  });
});
