import { FactTableColumnType } from "shared/types/fact-table";

/**
 * Maps the column types a warehouse reports for a query's output schema onto
 * GrowthBook's Fact Table column types. Every SQL data source reports that
 * schema without returning rows, which is what lets the Fact Table create flow
 * read a query's columns without scanning the table.
 *
 * `undefined` means "we don't recognize this type", which callers persist as an
 * undetected datatype rather than guessing. "other" is for types we do
 * recognize but don't model.
 *
 * BigQuery's mapping lives in `services/bigquery.ts` and Snowflake's in
 * `services/snowflake.ts`, since neither reports a type string.
 */

/**
 * Trino/Presto, and Athena which is built on it. Athena reports the Hive
 * spelling for some types (`string`, `struct<...>`, `int`), so both vocabularies
 * are covered here.
 */
export function getFactTableTypeFromTrinoType(
  dataType: string,
): FactTableColumnType | undefined {
  // Types are parameterized: `varchar(10)`, `decimal(10,2)`, `timestamp(3) with
  // time zone`, `row(a bigint, b varchar)`, `array<string>`.
  const base = dataType.trim().toLowerCase().split(/[(<]/)[0].trim();

  switch (base) {
    case "boolean":
      return "boolean";
    case "tinyint":
    case "smallint":
    case "integer":
    case "int":
    case "bigint":
    case "real":
    case "float":
    case "double":
    case "decimal":
    case "numeric":
      return "number";
    case "char":
    case "varchar":
    case "string":
    case "uuid":
    case "ipaddress":
      return "string";
    case "binary":
    case "varbinary":
      return "binary";
    case "json":
    case "row":
    case "struct":
    case "map":
      return "json";
    case "array":
    case "unknown":
      return "other";
  }

  // `timestamp with time zone`, `time with time zone`, `interval day to second`
  if (base.startsWith("timestamp") || base.startsWith("date")) return "date";
  if (base.startsWith("time")) return "date";
  if (base.startsWith("interval")) return "other";

  return undefined;
}

export function getFactTableTypeFromClickHouseType(
  dataType: string,
): FactTableColumnType | undefined {
  const trimmed = dataType.trim();

  // These wrap the real type rather than being types themselves
  const wrapped = trimmed.match(/^(?:Nullable|LowCardinality)\((.*)\)$/i);
  if (wrapped) return getFactTableTypeFromClickHouseType(wrapped[1]);

  // Parameterized: `FixedString(8)`, `DateTime64(3, 'UTC')`, `Decimal(10, 2)`,
  // `Enum8('a' = 1)`, `Tuple(a String)`
  const base = trimmed.split("(")[0].trim();

  if (/^(U?Int|Float|Decimal)\d*$/i.test(base)) return "number";
  if (/^Date(32)?$/i.test(base) || /^DateTime(64)?$/i.test(base)) return "date";
  if (/^Enum\d*$/i.test(base)) return "string";

  switch (base.toLowerCase()) {
    case "bool":
    case "boolean":
      return "boolean";
    case "string":
    case "fixedstring":
    case "uuid":
    case "ipv4":
    case "ipv6":
      return "string";
    // Dynamic and Variant hold values of varying type; the managed warehouse
    // uses them for the `attributes`/`properties` maps.
    case "json":
    case "object":
    case "dynamic":
    case "variant":
    case "tuple":
    case "map":
    case "nested":
      return "json";
    case "array":
    case "nothing":
    case "point":
    case "ring":
    case "polygon":
    case "multipolygon":
    case "aggregatefunction":
    case "simpleaggregatefunction":
      return "other";
  }

  return undefined;
}

/**
 * MySQL reports a numeric protocol type code per column rather than a type name.
 * Codes are from the wire protocol (mysql2's `lib/constants/types.js`).
 *
 * MySQL has no boolean type -- `BOOLEAN` is an alias for `TINYINT(1)` -- so
 * those columns are numbers, which is what the driver returns for them anyway.
 */
export function getFactTableTypeFromMysqlTypeCode(
  columnType: number,
  // MySQL uses the same type codes for text and binary columns and tells them
  // apart by charset. 63 is the `binary` charset.
  characterSet?: number,
): FactTableColumnType | undefined {
  const isBinaryCharset = characterSet === 63;

  switch (columnType) {
    case 0x00: // DECIMAL
    case 0x01: // TINY
    case 0x02: // SHORT
    case 0x03: // LONG
    case 0x04: // FLOAT
    case 0x05: // DOUBLE
    case 0x08: // LONGLONG
    case 0x09: // INT24
    case 0x0d: // YEAR
    case 0xf6: // NEWDECIMAL
      return "number";

    case 0x07: // TIMESTAMP
    case 0x0a: // DATE
    case 0x0b: // TIME
    case 0x0c: // DATETIME
    case 0x0e: // NEWDATE
      return "date";

    case 0xf5: // JSON
      return "json";

    case 0x0f: // VARCHAR
    case 0xf7: // ENUM
    case 0xf8: // SET
      return "string";

    // TINYBLOB/BLOB/MEDIUMBLOB/LONGBLOB are also TINYTEXT/TEXT/MEDIUMTEXT/
    // LONGTEXT, and VAR_STRING/STRING are also VARBINARY/BINARY
    case 0xf9:
    case 0xfa:
    case 0xfb:
    case 0xfc:
    case 0xfd:
    case 0xfe:
      return isBinaryCharset ? "binary" : "string";

    case 0x06: // NULL, i.e. an all-null expression -- type is unknowable
      return undefined;

    case 0x10: // BIT
    case 0xf2: // VECTOR
    case 0xff: // GEOMETRY
      return "other";
  }

  return undefined;
}

/**
 * MS SQL Server, keyed on the `declaration` the mssql driver attaches to each
 * column's type (a lowercased T-SQL type name).
 */
export function getFactTableTypeFromMssqlDeclaration(
  declaration: string,
): FactTableColumnType | undefined {
  switch (declaration.trim().toLowerCase()) {
    case "bit":
      return "boolean";
    case "int":
    case "bigint":
    case "tinyint":
    case "smallint":
    case "float":
    case "real":
    case "numeric":
    case "decimal":
    case "money":
    case "smallmoney":
      return "number";
    case "date":
    case "datetime":
    case "datetime2":
    case "datetimeoffset":
    case "smalldatetime":
    case "time":
      return "date";
    case "varchar":
    case "nvarchar":
    case "char":
    case "nchar":
    case "text":
    case "ntext":
    case "uniqueidentifier":
      return "string";
    case "binary":
    case "varbinary":
    case "image":
      return "binary";
    // SQL Server has no JSON type; JSON is stored in nvarchar and detected from
    // the data instead. `xml` is structured but not JSON.
    case "xml":
    case "geography":
    case "geometry":
    case "udt":
    case "tvp":
    case "variant":
      return "other";
  }

  return undefined;
}

/**
 * Postgres builtin type OIDs (`pg_type.oid`). Stable across versions and shared
 * by Redshift, which is Postgres-derived.
 *
 * NOT passed for every data source on this driver. Vertica and Adobe
 * Experience Platform Query Service speak the Postgres wire protocol but their
 * OID numbering is unverified, and Vertica's is known to differ (its 16 is
 * numeric, where Postgres uses 16 for boolean) -- mistyping a column silently
 * is worse than reporting it as undetected, so they report names only.
 *
 * User-defined types (enums, domains, composites) get OIDs assigned at creation
 * time and can't be listed here; they come back undetected.
 */
const POSTGRES_OID_TYPES: Record<number, FactTableColumnType> = {
  16: "boolean",
  17: "binary", // bytea
  18: "string", // char
  19: "string", // name
  20: "number", // int8
  21: "number", // int2
  23: "number", // int4
  25: "string", // text
  26: "number", // oid
  114: "json",
  700: "number", // float4
  701: "number", // float8
  1042: "string", // bpchar
  1043: "string", // varchar
  1082: "date",
  1083: "date", // time
  1114: "date", // timestamp
  1184: "date", // timestamptz
  1186: "other", // interval
  1266: "date", // timetz
  1700: "number", // numeric
  2950: "string", // uuid
  3802: "json", // jsonb
};

export function getFactTableTypeFromPostgresOid(
  oid: number,
): FactTableColumnType | undefined {
  return POSTGRES_OID_TYPES[oid];
}
