import { set, subDays, addDays } from "date-fns";
import { utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";
import {
  AggregatedFactTableSettings,
  ColumnInterface,
  CreateColumnProps,
  JSONColumnFields,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

// Throws if a column property is incompatible with its datatype. Empty datatype
// skips checks while auto-detection is pending.
export function assertColumnDatatypeConstraints(column: ColumnInterface): void {
  if (column.datatype === "") return;

  if (column.alwaysInlineFilter && column.datatype !== "string") {
    throw new Error("Only string columns are eligible for inline filtering");
  }

  if (
    column.isAutoSliceColumn &&
    column.datatype !== "string" &&
    column.datatype !== "boolean"
  ) {
    throw new Error(
      "Only string or boolean columns are eligible for auto slice analysis",
    );
  }

  if (column.numberFormat && column.datatype !== "number") {
    throw new Error("Only number columns are eligible for a number format");
  }

  if (
    column.jsonFields &&
    Object.keys(column.jsonFields).length > 0 &&
    column.datatype !== "json"
  ) {
    throw new Error("Only JSON columns are eligible for jsonFields");
  }
}

// Clears datatype-incompatible props; used by the async column-type detection job.
export function reconcileColumnDatatypeConstraints(
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
): string[] {
  const activeColumns = new Set(
    columns.filter((c) => !c.deleted).map((c) => c.column),
  );

  return (datasource.settings?.userIdTypes || [])
    .map((u) => u.userIdType)
    .filter((id) => activeColumns.has(id));
}

export function columnsHaveAutoSlices(
  columns?: Array<{ isAutoSliceColumn?: boolean; autoSlices?: unknown }>,
): boolean {
  return (columns ?? []).some((c) => !!c.isAutoSliceColumn || !!c.autoSlices);
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
