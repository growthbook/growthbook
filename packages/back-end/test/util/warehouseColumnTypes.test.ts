import {
  getFactTableTypeFromClickHouseType,
  getFactTableTypeFromMssqlDeclaration,
  getFactTableTypeFromMysqlTypeCode,
  getFactTableTypeFromPostgresOid,
  getFactTableTypeFromTrinoType,
} from "back-end/src/util/warehouseColumnTypes";

describe("warehouse column types", () => {
  describe("getFactTableTypeFromTrinoType", () => {
    it("maps the base types", () => {
      expect(getFactTableTypeFromTrinoType("boolean")).toBe("boolean");
      expect(getFactTableTypeFromTrinoType("bigint")).toBe("number");
      expect(getFactTableTypeFromTrinoType("double")).toBe("number");
      expect(getFactTableTypeFromTrinoType("varchar")).toBe("string");
      expect(getFactTableTypeFromTrinoType("date")).toBe("date");
      expect(getFactTableTypeFromTrinoType("json")).toBe("json");
      expect(getFactTableTypeFromTrinoType("varbinary")).toBe("binary");
      expect(getFactTableTypeFromTrinoType("array(varchar)")).toBe("other");
    });

    it("ignores type parameters", () => {
      expect(getFactTableTypeFromTrinoType("varchar(255)")).toBe("string");
      expect(getFactTableTypeFromTrinoType("decimal(10,2)")).toBe("number");
      expect(getFactTableTypeFromTrinoType("timestamp(3)")).toBe("date");
      expect(getFactTableTypeFromTrinoType("row(a bigint, b varchar)")).toBe(
        "json",
      );
    });

    it("handles the time-zone suffixes", () => {
      expect(getFactTableTypeFromTrinoType("timestamp with time zone")).toBe(
        "date",
      );
      expect(getFactTableTypeFromTrinoType("timestamp(6) with time zone")).toBe(
        "date",
      );
      expect(getFactTableTypeFromTrinoType("time with time zone")).toBe("date");
      expect(getFactTableTypeFromTrinoType("interval day to second")).toBe(
        "other",
      );
    });

    it("handles the Hive spellings Athena reports", () => {
      expect(getFactTableTypeFromTrinoType("string")).toBe("string");
      expect(getFactTableTypeFromTrinoType("int")).toBe("number");
      expect(getFactTableTypeFromTrinoType("struct<a:string>")).toBe("json");
      expect(getFactTableTypeFromTrinoType("binary")).toBe("binary");
    });

    it("returns undefined for types it doesn't know", () => {
      expect(getFactTableTypeFromTrinoType("hyperloglog")).toBeUndefined();
      expect(getFactTableTypeFromTrinoType("")).toBeUndefined();
    });
  });

  describe("getFactTableTypeFromClickHouseType", () => {
    it("maps the base types", () => {
      expect(getFactTableTypeFromClickHouseType("String")).toBe("string");
      expect(getFactTableTypeFromClickHouseType("UInt64")).toBe("number");
      expect(getFactTableTypeFromClickHouseType("Int8")).toBe("number");
      expect(getFactTableTypeFromClickHouseType("Float64")).toBe("number");
      expect(getFactTableTypeFromClickHouseType("Bool")).toBe("boolean");
      expect(getFactTableTypeFromClickHouseType("Date")).toBe("date");
      expect(getFactTableTypeFromClickHouseType("Date32")).toBe("date");
      expect(getFactTableTypeFromClickHouseType("DateTime")).toBe("date");
      expect(getFactTableTypeFromClickHouseType("UUID")).toBe("string");
      expect(getFactTableTypeFromClickHouseType("Array(String)")).toBe("other");
    });

    it("ignores type parameters", () => {
      expect(getFactTableTypeFromClickHouseType("FixedString(8)")).toBe(
        "string",
      );
      expect(getFactTableTypeFromClickHouseType("DateTime64(3, 'UTC')")).toBe(
        "date",
      );
      expect(getFactTableTypeFromClickHouseType("Decimal(10, 2)")).toBe(
        "number",
      );
      expect(getFactTableTypeFromClickHouseType("Enum8('a' = 1)")).toBe(
        "string",
      );
    });

    it("unwraps Nullable and LowCardinality", () => {
      expect(getFactTableTypeFromClickHouseType("Nullable(UInt32)")).toBe(
        "number",
      );
      expect(getFactTableTypeFromClickHouseType("LowCardinality(String)")).toBe(
        "string",
      );
      expect(
        getFactTableTypeFromClickHouseType("Nullable(DateTime64(3))"),
      ).toBe("date");
      expect(
        getFactTableTypeFromClickHouseType("LowCardinality(Nullable(String))"),
      ).toBe("string");
    });

    it("maps the variable-shape types to json", () => {
      expect(getFactTableTypeFromClickHouseType("JSON")).toBe("json");
      expect(getFactTableTypeFromClickHouseType("Dynamic")).toBe("json");
      expect(getFactTableTypeFromClickHouseType("Map(String, String)")).toBe(
        "json",
      );
      expect(getFactTableTypeFromClickHouseType("Tuple(a String)")).toBe(
        "json",
      );
    });

    it("returns undefined for types it doesn't know", () => {
      expect(getFactTableTypeFromClickHouseType("IntervalDay")).toBeUndefined();
      expect(getFactTableTypeFromClickHouseType("")).toBeUndefined();
    });
  });

  describe("getFactTableTypeFromMysqlTypeCode", () => {
    const BINARY_CHARSET = 63;
    const UTF8_CHARSET = 255;

    it("maps the numeric type codes", () => {
      expect(getFactTableTypeFromMysqlTypeCode(0x03)).toBe("number"); // INT
      expect(getFactTableTypeFromMysqlTypeCode(0x08)).toBe("number"); // BIGINT
      expect(getFactTableTypeFromMysqlTypeCode(0xf6)).toBe("number"); // DECIMAL
      expect(getFactTableTypeFromMysqlTypeCode(0x0c)).toBe("date"); // DATETIME
      expect(getFactTableTypeFromMysqlTypeCode(0x0a)).toBe("date"); // DATE
      expect(getFactTableTypeFromMysqlTypeCode(0xf5)).toBe("json");
      expect(getFactTableTypeFromMysqlTypeCode(0x0f)).toBe("string"); // VARCHAR
      expect(getFactTableTypeFromMysqlTypeCode(0xf7)).toBe("string"); // ENUM
      expect(getFactTableTypeFromMysqlTypeCode(0xff)).toBe("other"); // GEOMETRY
    });

    it("maps TINYINT to a number, since MySQL has no boolean", () => {
      expect(getFactTableTypeFromMysqlTypeCode(0x01)).toBe("number");
    });

    it("tells text apart from binary by charset", () => {
      // BLOB/TEXT share a type code, as do VAR_STRING/VARBINARY
      expect(getFactTableTypeFromMysqlTypeCode(0xfc, UTF8_CHARSET)).toBe(
        "string",
      );
      expect(getFactTableTypeFromMysqlTypeCode(0xfc, BINARY_CHARSET)).toBe(
        "binary",
      );
      expect(getFactTableTypeFromMysqlTypeCode(0xfd, UTF8_CHARSET)).toBe(
        "string",
      );
      expect(getFactTableTypeFromMysqlTypeCode(0xfd, BINARY_CHARSET)).toBe(
        "binary",
      );
    });

    it("returns undefined for an all-null expression and unknown codes", () => {
      expect(getFactTableTypeFromMysqlTypeCode(0x06)).toBeUndefined(); // NULL
      expect(getFactTableTypeFromMysqlTypeCode(0x99)).toBeUndefined();
    });
  });

  describe("getFactTableTypeFromMssqlDeclaration", () => {
    it("maps the T-SQL type names", () => {
      expect(getFactTableTypeFromMssqlDeclaration("bit")).toBe("boolean");
      expect(getFactTableTypeFromMssqlDeclaration("int")).toBe("number");
      expect(getFactTableTypeFromMssqlDeclaration("decimal")).toBe("number");
      expect(getFactTableTypeFromMssqlDeclaration("money")).toBe("number");
      expect(getFactTableTypeFromMssqlDeclaration("nvarchar")).toBe("string");
      expect(getFactTableTypeFromMssqlDeclaration("uniqueidentifier")).toBe(
        "string",
      );
      expect(getFactTableTypeFromMssqlDeclaration("datetime2")).toBe("date");
      expect(getFactTableTypeFromMssqlDeclaration("datetimeoffset")).toBe(
        "date",
      );
      expect(getFactTableTypeFromMssqlDeclaration("varbinary")).toBe("binary");
      expect(getFactTableTypeFromMssqlDeclaration("xml")).toBe("other");
    });

    it("returns undefined for names it doesn't know", () => {
      expect(getFactTableTypeFromMssqlDeclaration("cursor")).toBeUndefined();
    });
  });

  describe("getFactTableTypeFromPostgresOid", () => {
    it("maps the builtin OIDs", () => {
      expect(getFactTableTypeFromPostgresOid(16)).toBe("boolean");
      expect(getFactTableTypeFromPostgresOid(23)).toBe("number"); // int4
      expect(getFactTableTypeFromPostgresOid(1700)).toBe("number"); // numeric
      expect(getFactTableTypeFromPostgresOid(25)).toBe("string"); // text
      expect(getFactTableTypeFromPostgresOid(1043)).toBe("string"); // varchar
      expect(getFactTableTypeFromPostgresOid(1114)).toBe("date"); // timestamp
      expect(getFactTableTypeFromPostgresOid(1184)).toBe("date"); // timestamptz
      expect(getFactTableTypeFromPostgresOid(3802)).toBe("json"); // jsonb
      expect(getFactTableTypeFromPostgresOid(17)).toBe("binary"); // bytea
    });

    it("returns undefined for arrays and user-defined types", () => {
      expect(getFactTableTypeFromPostgresOid(1009)).toBeUndefined(); // text[]
      expect(getFactTableTypeFromPostgresOid(24576)).toBeUndefined();
    });
  });
});
