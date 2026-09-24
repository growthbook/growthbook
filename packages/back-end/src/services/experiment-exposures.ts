import type { ExperimentExposureRecord } from "shared/validators";
import { columnNamesMatch } from "back-end/src/util/sql";

// 100 rows x 40 columns x 1000 chars caps a page at roughly 4MB of JSON.
export const MAX_EXTRA_COLUMNS = 40;
export const MAX_VALUE_LENGTH = 1000;

export interface ShapeExposureRowsParams {
  rows: Record<string, unknown>[];
  /** Exposure query column holding the unit id. */
  userIdType: string;
  /** Dimensions declared on the exposure query, in configured order. */
  dimensions: string[];
  caseSensitive: boolean;
}

export interface ShapedExposures {
  records: ExperimentExposureRecord[];
  extraColumns: string[];
}

/** Normalize a naive warehouse timestamp to an ISO string, assuming UTC. */
export function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : value.toISOString();
  }
  const raw = value == null ? "" : String(value);
  if (!raw) return "";
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return isNaN(date.getTime()) ? raw : date.toISOString();
}

function truncateValue(value: string): string {
  return value.length <= MAX_VALUE_LENGTH
    ? value
    : value.slice(0, MAX_VALUE_LENGTH) + "…";
}

/**
 * Warehouse drivers return Dates, bigints, Buffers and nested objects. Coerce
 * everything to a string so JSON output does not depend on the engine.
 */
export function coerceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return truncateValue(JSON.stringify(value));
    } catch {
      return truncateValue(String(value));
    }
  }
  return truncateValue(String(value));
}

/**
 * Read a column honoring the warehouse's identifier folding. Unquoted
 * identifiers come back lowercased on Postgres/Redshift/Vertica/Adobe and
 * uppercased from the Snowflake driver, so an exact key lookup misses.
 * See .agents/guides/backend/warehouse-column-casing.md
 */
export function getColumn(
  row: Record<string, unknown>,
  name: string,
  caseSensitive: boolean,
): unknown {
  if (name in row) return row[name];
  if (caseSensitive) return undefined;
  const match = Object.keys(row).find((key) =>
    columnNamesMatch(key, name, false),
  );
  return match === undefined ? undefined : row[match];
}

/**
 * Split raw exposure rows into the typed columns the table shows and an
 * `extra` bag of everything else, which drives the expandable row detail.
 *
 * `extra` is nested rather than spread so a warehouse column named `timestamp`
 * cannot shadow the typed field.
 */
export function shapeExposureRows({
  rows,
  userIdType,
  dimensions,
  caseSensitive,
}: ShapeExposureRowsParams): ShapedExposures {
  // Only columns already surfaced as typed fields. Everything else the
  // exposure query returned — experiment_id included — goes to `extra` so the
  // expanded row shows the complete record.
  const reserved = [userIdType, "timestamp", "variation_id", ...dimensions];
  const isReserved = (key: string) =>
    reserved.some((r) => columnNamesMatch(key, r, caseSensitive));

  const extraColumns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (isReserved(key)) continue;
      if (extraColumns.some((c) => columnNamesMatch(c, key, caseSensitive))) {
        continue;
      }
      if (extraColumns.length >= MAX_EXTRA_COLUMNS) break;
      extraColumns.push(key);
    }
  }

  const records = rows.map((row) => {
    const dimensionValues: Record<string, string | null> = {};
    for (const dim of dimensions) {
      dimensionValues[dim] = coerceValue(getColumn(row, dim, caseSensitive));
    }

    const extra: Record<string, string | null> = {};
    for (const key of extraColumns) {
      extra[key] = coerceValue(getColumn(row, key, caseSensitive));
    }

    return {
      timestamp: normalizeTimestamp(getColumn(row, "timestamp", caseSensitive)),
      userId: coerceValue(getColumn(row, userIdType, caseSensitive)),
      variationId:
        coerceValue(getColumn(row, "variation_id", caseSensitive)) ?? "",
      dimensions: dimensionValues,
      extra,
    };
  });

  return { records, extraColumns };
}
