import { ColumnInterface } from "shared/types/fact-table";
import {
  DataSourceInterface,
  GrowthbookClickhouseDataSource,
} from "shared/types/datasource";
import { deriveUserIdTypesFromColumns } from "back-end/src/util/factTable";

function makeColumn(column: string, deleted = false): ColumnInterface {
  return {
    column,
    deleted,
  } as unknown as ColumnInterface;
}

function makeClickhouseDatasource(
  materializedColumns: { columnName: string; type: string }[],
): GrowthbookClickhouseDataSource {
  return {
    type: "growthbook_clickhouse",
    settings: {
      materializedColumns,
      // growthbook_clickhouse syncs userIdTypes from materializedColumns
      // (type === "identifier") on every settings save via getManagedWarehouseSettings
      userIdTypes: materializedColumns
        .filter((c) => c.type === "identifier")
        .map((c) => ({ userIdType: c.columnName, description: "" })),
    },
  } as unknown as GrowthbookClickhouseDataSource;
}

function makeStandardDatasource(
  userIdTypes: { userIdType: string }[],
): DataSourceInterface {
  return {
    type: "redshift",
    settings: { userIdTypes },
  } as unknown as DataSourceInterface;
}

describe("deriveUserIdTypesFromColumns", () => {
  describe("growthbook_clickhouse datasource", () => {
    it("returns identifier userIdTypes that appear in active fact table columns", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
        { columnName: "device_id", type: "identifier" },
        { columnName: "revenue", type: "number" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("device_id"),
        makeColumn("revenue"),
      ];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([
        "user_id",
        "device_id",
      ]);
    });

    it("excludes deleted fact table columns", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
        { columnName: "device_id", type: "identifier" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("device_id", true), // deleted
      ];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual(["user_id"]);
    });

    it("excludes identifier columns not present in fact table columns", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
        { columnName: "anonymous_id", type: "identifier" }, // not in fact table
      ]);
      const cols = [makeColumn("user_id")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual(["user_id"]);
    });

    it("returns empty array when userIdTypes is empty", () => {
      const ds = makeClickhouseDatasource([]);
      const cols = [makeColumn("user_id"), makeColumn("event_name")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when userIdTypes is missing", () => {
      const ds = {
        type: "growthbook_clickhouse",
        settings: {},
      } as unknown as GrowthbookClickhouseDataSource;
      const cols = [makeColumn("user_id")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when no identifiers match any column", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "revenue", type: "number" },
        { columnName: "country", type: "string" },
      ]);
      const cols = [makeColumn("revenue"), makeColumn("country")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when all identifier columns are deleted", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
      ]);
      const cols = [makeColumn("user_id", true)];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when columns list is empty", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
      ]);
      expect(deriveUserIdTypesFromColumns(ds, [])).toEqual([]);
    });
  });

  describe("standard (non-ClickHouse) datasources", () => {
    it("returns datasource userIdTypes that appear as active fact table columns", () => {
      const ds = makeStandardDatasource([
        { userIdType: "user_id" },
        { userIdType: "anonymous_id" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("anonymous_id"),
        makeColumn("revenue"),
      ];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([
        "user_id",
        "anonymous_id",
      ]);
    });

    it("excludes deleted fact table columns", () => {
      const ds = makeStandardDatasource([
        { userIdType: "user_id" },
        { userIdType: "anonymous_id" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("anonymous_id", true), // deleted
      ];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual(["user_id"]);
    });

    it("excludes userIdTypes not present as columns in the fact table", () => {
      const ds = makeStandardDatasource([
        { userIdType: "user_id" },
        { userIdType: "anonymous_id" }, // not a column
      ]);
      const cols = [makeColumn("user_id"), makeColumn("revenue")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual(["user_id"]);
    });

    it("returns empty array when datasource has no userIdTypes", () => {
      const ds = makeStandardDatasource([]);
      const cols = [makeColumn("user_id")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when datasource userIdTypes is missing", () => {
      const ds = {
        type: "redshift",
        settings: {},
      } as unknown as DataSourceInterface;
      const cols = [makeColumn("user_id")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when columns list is empty", () => {
      const ds = makeStandardDatasource([{ userIdType: "user_id" }]);
      expect(deriveUserIdTypesFromColumns(ds, [])).toEqual([]);
    });

    it("returns empty array when no identifiers match any column", () => {
      const ds = makeStandardDatasource([{ userIdType: "user_id" }]);
      const cols = [makeColumn("revenue"), makeColumn("country")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });
  });
});
