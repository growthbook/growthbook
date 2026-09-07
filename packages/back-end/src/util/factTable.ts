import { set, subDays, addDays } from "date-fns";
import { utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";
import { validateVirtualColumnExpression } from "shared/experiments";
import {
  AggregatedFactTableSettings,
  ColumnInterface,
  CreateColumnProps,
  FactTableInterface,
  JSONColumnFields,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

/**
 * Clears datatype-incompatible props. Empty datatype skips checks while
 * auto-detection is pending.
 */
export function stripIncompatibleFields(
  column: ColumnInterface,
): ColumnInterface {
  if (column.datatype === "") return column;

  const next = { ...column };

  if (next.alwaysInlineFilter && next.datatype !== "string") {
    next.alwaysInlineFilter = false;
  }

  if (
    next.isAutoSliceColumn &&
    next.datatype !== "string" &&
    next.datatype !== "boolean"
  ) {
    next.isAutoSliceColumn = false;
    next.autoSlices = undefined;
  }

  if (next.numberFormat && next.datatype !== "number") {
    next.numberFormat = "";
  }

  if (
    next.jsonFields &&
    Object.keys(next.jsonFields).length > 0 &&
    next.datatype !== "json"
  ) {
    next.jsonFields = undefined;
  }

  return next;
}

// A virtual column's id must be a plain identifier ending in `_vc`, so it is
// visually distinct from SQL-detected columns and safe to inline into
// generated SQL.
export const VIRTUAL_COLUMN_ID_REGEX = /^[a-zA-Z0-9_]+_vc$/;

/**
 * A virtual column's expression is inlined into generated SQL as `(<sql>)`, so
 * it must be a single self-contained scalar expression that cannot break out of
 * those parentheses. Throws when it can (statement separator, unbalanced paren,
 * unterminated literal or comment).
 */
export function validateVirtualColumnSql(sql: string): void {
  const error = validateVirtualColumnExpression(sql);
  if (error) {
    throw new Error(error);
  }
}

/**
 * Shared validation for virtual-column input, used by the internal route, the
 * public REST API, and bulk import so every write path enforces the same
 * rules: a `_vc` identifier, a non-empty and structurally safe SQL expression,
 * and an explicit data type (the refresh job cannot auto-detect a virtual
 * column's type).
 */
export function validateVirtualColumnProps(data: {
  column: string;
  sql?: string;
  datatype?: string;
}): void {
  if (!data.column.match(VIRTUAL_COLUMN_ID_REGEX)) {
    throw new Error(
      "Virtual column ids must contain only letters, numbers, and underscores and end with '_vc'",
    );
  }
  if (!data.sql || !data.sql.trim()) {
    throw new Error("Virtual columns require a SQL expression");
  }
  validateVirtualColumnSql(data.sql);
  if (!data.datatype) {
    throw new Error("Virtual columns require a data type");
  }
}

/**
 * Auto-slice columns default to an empty slice list until the refresh job
 * populates it. Boolean columns always use `["true", "false"]`; any other
 * stored value is ignored downstream (see slice generation in
 * shared/experiments).
 */
export function ensureAutoSliceDefaults(
  column: ColumnInterface,
): ColumnInterface {
  const next = { ...column };

  if (next.isAutoSliceColumn && !next.autoSlices) {
    next.autoSlices = [];
  }

  if (next.datatype === "boolean" && next.autoSlices) {
    next.autoSlices = ["true", "false"];
  }

  return next;
}

/**
 * Shared create/upsert/detection path so a stored column looks the same
 * regardless of which write produced it.
 */
export function normalizePersistedColumn(
  column: ColumnInterface,
): ColumnInterface {
  return ensureAutoSliceDefaults(stripIncompatibleFields(column));
}

export function normalizeJSONFieldsInput(
  jsonFields: CreateColumnProps["jsonFields"],
): JSONColumnFields | undefined {
  if (!jsonFields) return undefined;
  return Object.fromEntries(
    Object.entries(jsonFields).map(([field, value]) => [
      field,
      { ...value, datatype: value.datatype ?? "" },
    ]),
  );
}

/**
 * Derives the userIdTypes for a fact table by intersecting the datasource's
 * declared identifier types with the fact table's active (non-deleted) columns.
 *
 * All datasource types store their identifier types in
 * datasource.settings.userIdTypes (growthbook_clickhouse syncs its
 * materializedColumns with type === "identifier" into this field on every
 * settings save).
 */
export function deriveUserIdTypesFromColumns(
  datasource: DataSourceInterface,
  columns: ColumnInterface[],
  userIdColumns?: FactTableInterface["userIdColumns"],
): string[] {
  const activeColumns = columns.filter((c) => !c.deleted);
  const activeColumnNames = new Set(activeColumns.map((c) => c.column));

  const isResolvable = (column: string): boolean => {
    if (activeColumnNames.has(column)) return true;
    const [root, ...path] = column.split(".");
    return (
      path.length > 0 &&
      activeColumns.some((c) => c.column === root && c.datatype === "json")
    );
  };

  return (datasource.settings?.userIdTypes || [])
    .map((u) => u.userIdType)
    .filter((id) => isResolvable(userIdColumns?.[id] || id));
}

/**
 * Only keys the write is introducing are checked. Deleting an identifier type
 * from a Data Source leaves stale keys behind on every fact table that mapped
 * it, and those must not block an unrelated edit — API clients routinely
 * round-trip the whole mapping on save.
 *
 * Keys are checked against the Data Source's identifier types rather than the
 * fact table's own userIdTypes, because a column refresh re-derives userIdTypes
 * from this mapping — mapping a type the fact table doesn't list yet is how you
 * add it.
 */
export function validateNewUserIdColumnKeys({
  datasource,
  userIdColumns,
  existingUserIdColumns,
}: {
  datasource: DataSourceInterface;
  userIdColumns: FactTableInterface["userIdColumns"];
  existingUserIdColumns?: FactTableInterface["userIdColumns"];
}): void {
  const identifierTypes = new Set(
    (datasource.settings?.userIdTypes || []).map((t) => t.userIdType),
  );

  for (const idType of Object.keys(userIdColumns || {})) {
    if (existingUserIdColumns && idType in existingUserIdColumns) continue;
    if (!identifierTypes.has(idType)) {
      throw new Error(
        `Invalid userIdColumns key: ${idType} is not an identifier type on this Data Source`,
      );
    }
  }
}

/**
 * A mapping has to name a column generated SQL can actually read, so callers
 * pass the post-write column state. Column detection runs asynchronously, so a
 * request that sets a mapping has to send `columns` too rather than mapping
 * onto columns nobody has seen yet. Only values the write is changing are
 * checked, so a column later dropped from the SQL doesn't block an unrelated
 * edit that round-trips the whole mapping.
 */
export function validateColumnMappingTargets({
  columns,
  timestampColumn,
  userIdColumns,
  existing,
}: {
  columns: ColumnInterface[];
  timestampColumn?: string;
  userIdColumns?: FactTableInterface["userIdColumns"];
  existing?: Pick<FactTableInterface, "timestampColumn" | "userIdColumns">;
}): void {
  const active = columns.filter((c) => !c.deleted);
  // Without columns the mapping can't be checked at all, and it ends up
  // interpolated into generated SQL -- so say what the caller has to do.
  const where = active.length
    ? "on this fact table"
    : "-- this fact table has no columns yet, so send `columns` in the same request";

  // "other" covers warehouse types we don't model; an undetected datatype ("")
  // is unknown rather than wrong, so it's left alone.
  const find = (name: string, allowed: string[]) =>
    active.find(
      (c) => c.column === name && (!c.datatype || allowed.includes(c.datatype)),
    );

  if (timestampColumn && timestampColumn !== existing?.timestampColumn) {
    // Emitted as a bare `m.<name>`, so a virtual column's expression and a JSON
    // field path would both reach the warehouse as invalid SQL.
    const column = find(timestampColumn, ["date", "other"]);
    if (!column || column.isVirtual) {
      throw new Error(
        `Invalid timestampColumn: ${timestampColumn} is not a date column ${where}`,
      );
    }
  }

  for (const [idType, column] of Object.entries(userIdColumns || {})) {
    if (!column || column === existing?.userIdColumns?.[idType]) continue;
    const [root, field, ...rest] = column.split(".");
    const resolved = field
      ? !rest.length && find(root, ["json"])
      : find(column, ["string", "number", "other"]);
    if (!resolved) {
      throw new Error(
        `Invalid userIdColumns value for ${idType}: ${column} is not an identifier column or JSON field path ${where}`,
      );
    }
  }
}

export function columnsHaveAutoSlices(
  columns?: Array<{ isAutoSliceColumn?: boolean; autoSlices?: unknown }>,
): boolean {
  return (columns ?? []).some((c) => !!c.isAutoSliceColumn || !!c.autoSlices);
}

export function columnsNeedDetection(
  columns?: Array<{ datatype?: string; deleted?: boolean }>,
): boolean {
  return (columns ?? []).some((c) => !c.datatype && !c.deleted);
}

function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// Throws if the aggregated fact table settings are invalid: every id type must
// be one of the fact table's userIdTypes, updateTime must be a valid "HH:mm"
// time in a valid IANA timezone, and lookbackWindow must be a positive integer.
export function validateAggregatedFactTableSettings(
  settings: AggregatedFactTableSettings,
  userIdTypes: string[],
): void {
  for (const idType of settings.idTypes) {
    if (!userIdTypes.includes(idType)) {
      throw new Error(
        `Invalid aggregatedFactTableSettings id type "${idType}": must be one of the fact table's userIdTypes`,
      );
    }
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.updateTime.time)) {
    throw new Error(
      `Invalid aggregatedFactTableSettings updateTime.time "${settings.updateTime.time}": must be in "HH:mm" 24-hour format`,
    );
  }

  if (!isValidIanaTimezone(settings.updateTime.timezone)) {
    throw new Error(
      `Invalid aggregatedFactTableSettings updateTime.timezone "${settings.updateTime.timezone}": must be a valid IANA timezone`,
    );
  }

  if (
    !Number.isInteger(settings.lookbackWindow) ||
    settings.lookbackWindow <= 0
  ) {
    throw new Error(
      `Invalid aggregatedFactTableSettings lookbackWindow "${settings.lookbackWindow}": must be a positive integer number of days`,
    );
  }
}

type UpdateTime = AggregatedFactTableSettings["updateTime"];

function applyUpdateTimeToZonedDate(zoned: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  return set(zoned, { hours, minutes, seconds: 0, milliseconds: 0 });
}

// The most recent moment (<= now) when the table's daily updateTime fired,
// resolved in the table's timezone. Used by the poller to derive the slot to
// claim for the current day.
export function getMostRecentUpdateOccurrence(
  updateTime: UpdateTime,
  now: Date = new Date(),
): Date {
  const { time, timezone } = updateTime;
  const zonedNow = utcToZonedTime(now, timezone);
  const todayZoned = applyUpdateTimeToZonedDate(zonedNow, time);
  let occurrenceUtc = zonedTimeToUtc(todayZoned, timezone);
  if (occurrenceUtc.getTime() > now.getTime()) {
    occurrenceUtc = zonedTimeToUtc(subDays(todayZoned, 1), timezone);
  }
  return occurrenceUtc;
}

// The next moment (> now) when the table's daily updateTime will fire, resolved
// in the table's timezone. Used by the status endpoint.
export function getNextUpdateOccurrence(
  updateTime: UpdateTime,
  now: Date = new Date(),
): Date {
  const { time, timezone } = updateTime;
  const zonedNow = utcToZonedTime(now, timezone);
  const todayZoned = applyUpdateTimeToZonedDate(zonedNow, time);
  let occurrenceUtc = zonedTimeToUtc(todayZoned, timezone);
  if (occurrenceUtc.getTime() <= now.getTime()) {
    occurrenceUtc = zonedTimeToUtc(addDays(todayZoned, 1), timezone);
  }
  return occurrenceUtc;
}
