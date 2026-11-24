import chunk from "lodash/chunk";
import cloneDeep from "lodash/cloneDeep";
import {
  canInlineFilterColumn,
  getFactTableTimestampColumn,
} from "shared/experiments";
import {
  DEFAULT_MAX_METRIC_SLICE_LEVELS,
  DEFAULT_TOP_VALUES_LOOKBACK_VALUE,
  DEFAULT_TOP_VALUES_LOOKBACK_UNIT,
} from "shared/constants";
import { OrganizationSettings } from "shared/types/organization";
import {
  ColumnInterface,
  FactTableInterface,
  TopValuesSnapshot,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { ReqContext } from "back-end/types/request";
import {
  columnNamesMatch,
  getColumnByName,
  mergeJsonFields,
} from "back-end/src/util/sql";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import {
  buildColumnTypeMaps,
  normalizePersistedColumn,
} from "back-end/src/util/factTable";
import {
  canHaveTopValues,
  type TopValuesUpdate,
} from "back-end/src/util/topValues";
import { logger } from "back-end/src/util/logger";

export const MAX_COLUMNS_WITH_TOP_VALUES = 50;
export const MAX_TOP_VALUE_LENGTH = 100;
export const MAX_PRIMARY_TOP_VALUES = 500;
const SAFE_JSON_FIELD_PATH =
  /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
export const TOP_VALUES_CHUNK_SIZE = 25;

type TopValuesLookbackUnit = NonNullable<
  OrganizationSettings["topValuesLookbackUnit"]
>;

function getTopValuesLookbackDays(
  value: number,
  unit: TopValuesLookbackUnit,
): number {
  switch (unit) {
    case "days":
      return value;
    default: {
      unit satisfies never;
      throw new Error(`Unsupported top values lookback unit: ${unit}`);
    }
  }
}

// Selects the string columns on a fact table that should have topValues
// populated. Columns explicitly opted-in via alwaysInlineFilter or
// isAutoSliceColumn are always included.
//
// We then fill up to maxColumns total with additional eligible string columns
// to give users dropdown filter pickers by default.
//
// The total cap keeps the stored fact-table document well under Mongo's
// 16MB per-doc limit, and matching it to a multiple of TOP_VALUES_CHUNK_SIZE
// avoids small trailing chunks in the batch query. Running top-values for every string column would
// re-scan the fact table once per column, so we fall back to the legacy
// behavior of only populating the explicitly-opted-in columns.
export function selectColumnsForTopValues({
  columns,
  userIdTypes,
  userIdColumns,
  maxColumns = MAX_COLUMNS_WITH_TOP_VALUES,
}: {
  columns: ColumnInterface[];
  userIdTypes: string[];
  userIdColumns?: Record<string, string>;
  maxColumns?: number;
}): ColumnInterface[] {
  const factTableLike = { columns, userIdTypes, userIdColumns };
  const eligible = columns.filter((col) =>
    canHaveTopValues(factTableLike, col),
  );

  const alwaysCaptured = eligible.filter(
    (c) => c.alwaysInlineFilter || c.isAutoSliceColumn,
  );

  // String JSON fields go after plain columns; unescaped keys or virtual bases would break the chunk's SQL
  const jsonFieldColumns: ColumnInterface[] = columns.flatMap((col) =>
    col.datatype === "json" && !col.deleted && !col.isVirtual
      ? Object.entries(col.jsonFields ?? {})
          .filter(
            ([field, info]) =>
              info.datatype === "string" && SAFE_JSON_FIELD_PATH.test(field),
          )
          .map(([field]) => ({
            ...col,
            column: `${col.column}.${field}`,
            datatype: "string" as const,
            jsonFields: undefined,
            alwaysInlineFilter: false,
            isAutoSliceColumn: false,
          }))
          .filter((c) => canInlineFilterColumn(factTableLike, c.column))
      : [],
  );

  const remainingSlots = Math.max(0, maxColumns - alwaysCaptured.length);
  const newlyCaptured = [
    ...eligible.filter((c) => !c.alwaysInlineFilter && !c.isAutoSliceColumn),
    ...jsonFieldColumns,
  ].slice(0, remainingSlots);

  return [...alwaysCaptured, ...newlyCaptured];
}

type RankedValue = TopValuesSnapshot["values"][number];

export async function runColumnsTopValuesQuery(
  ...args: Parameters<typeof runColumnsTopValueCountsQuery>
): Promise<Record<string, string[]>> {
  const counts = await runColumnsTopValueCountsQuery(...args);
  return Object.fromEntries(
    Object.entries(counts).map(([column, rows]) => [
      column,
      rows.map((r) => r.value),
    ]),
  );
}

export async function runColumnsTopValueCountsQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<
    FactTableInterface,
    "sql" | "eventName" | "timestampColumn" | "columns"
  > & {
    // null only when the SQL isn't a saved fact table
    id: string | null;
  },
  columns: ColumnInterface[],
  options?: {
    limit?: number;
    searchTerm?: string;
  },
): Promise<Record<string, RankedValue[]>> {
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (
    !integration.getColumnsTopValuesQuery ||
    !integration.runColumnsTopValuesQuery
  ) {
    throw new Error("Top values not supported on this data source");
  }

  if (columns.length === 0) {
    return {};
  }

  const defaultLimit = Math.max(
    100,
    context.org.settings?.maxMetricSliceLevels ??
      DEFAULT_MAX_METRIC_SLICE_LEVELS,
  );
  // Always-filter columns (e.g. event_name) are the main filter pickers, so
  // they keep more values; the rest are trimmed back to the default below
  const primaryLimit = columns.some((c) => c.alwaysInlineFilter)
    ? Math.max(MAX_PRIMARY_TOP_VALUES, defaultLimit)
    : defaultLimit;

  const sql = integration.getColumnsTopValuesQuery({
    factTable,
    columns,
    limit: options?.limit ?? primaryLimit,
    lookbackDays: getTopValuesLookbackDays(
      context.org.settings?.topValuesLookbackValue ??
        DEFAULT_TOP_VALUES_LOOKBACK_VALUE,
      context.org.settings?.topValuesLookbackUnit ??
        DEFAULT_TOP_VALUES_LOOKBACK_UNIT,
    ),
    maxValueLength: MAX_TOP_VALUE_LENGTH,
    searchTerm: options?.searchTerm,
  });
  const result = await integration.runColumnsTopValuesQuery(sql, factTable.id);

  // Group results by column name
  const columnValues: Record<string, RankedValue[]> = {};
  const primaryColumns = new Set(
    columns.filter((c) => c.alwaysInlineFilter).map((c) => c.column),
  );
  for (const row of result.rows) {
    if (!columnValues[row.column]) {
      columnValues[row.column] = [];
    }
    if (
      !options?.limit &&
      !primaryColumns.has(row.column) &&
      columnValues[row.column].length >= defaultLimit
    ) {
      continue;
    }
    columnValues[row.column].push({ value: row.value, count: row.count });
  }

  return columnValues;
}

export async function runColumnDetectionQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<
    FactTableInterface,
    "sql" | "eventName" | "columns" | "userIdTypes" | "timestampColumn"
  > & {
    id: string | null;
  },
  // The columns to merge the detected types onto, read once the query is
  // done; defaults to factTable.columns
  loadColumns?: () => Promise<ColumnInterface[]>,
): Promise<ColumnInterface[]> {
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const caseSensitive = integration.columnNamesAreCaseSensitive;

  const timestampColumn = getFactTableTimestampColumn(factTable);

  const sql = integration.getTestQuery({
    query: factTable.sql,
    templateVariables: {
      eventName: factTable.eventName,
    },
    testDays: context.org.settings?.testQueryDays,
    limit: 20,
    timestampColumn,
  });

  const result = await integration.runTestQuery(
    sql,
    [timestampColumn],
    "factTableValidation",
    factTable.id,
  );

  const { jsonMap, warehouseTypeMap, datatypes } = buildColumnTypeMaps(result);

  const columns = cloneDeep(
    (await loadColumns?.()) ?? (factTable.columns || []),
  );

  // Update existing column
  columns.forEach((col) => {
    // Virtual columns are user-defined expressions that never appear in the
    // fact table's output schema, so they must be preserved by the refresh
    // rather than marked deleted. Their validity is recomputed below.
    if (col.isVirtual) {
      return;
    }

    // `datatypes`, not `typeMap` -- a column the engine named but neither it
    // nor the sampled rows could type still exists, and marking it deleted
    // would drop columns the create flow saved from a schema-only detection.
    const type = getColumnByName(datatypes, col.column, caseSensitive);
    const jsonFields = getColumnByName(jsonMap, col.column, caseSensitive);

    // Column no longer exists, mark as deleted
    if (type === undefined) {
      col.deleted = true;
      col.dateUpdated = new Date();
    }
    // Column exists
    else {
      if (col.deleted) {
        col.deleted = false;
        col.dateUpdated = new Date();
      }

      const warehouseType = getColumnByName(
        warehouseTypeMap,
        col.column,
        caseSensitive,
      );
      if (
        warehouseType !== undefined &&
        col.dataTypeFromWarehouse !== warehouseType
      ) {
        col.dataTypeFromWarehouse = warehouseType;
        col.dateUpdated = new Date();
      }

      // If we now know the datatype, update it
      if (col.datatype === "" && type !== "") {
        col.datatype = type;
        col.jsonFields = jsonFields?.fields;
        col.dateUpdated = new Date();
      }
      // If this is a JSON column, merge in the JSON fields
      else if (col.datatype === "json" && jsonFields !== undefined) {
        const { fields, changed } = mergeJsonFields(
          col.jsonFields,
          jsonFields,
          caseSensitive,
        );
        if (changed) {
          col.jsonFields = fields;
          col.dateUpdated = new Date();
        }
      }
    }
  });

  // Add new columns that don't exist yet
  datatypes.forEach((datatype, column) => {
    if (
      !columns.some((c) => columnNamesMatch(c.column, column, caseSensitive))
    ) {
      columns.push({
        column,
        datatype,
        dataTypeFromWarehouse: warehouseTypeMap.get(column),
        jsonFields: jsonMap.get(column)?.fields,
        dateCreated: new Date(),
        dateUpdated: new Date(),
        description: "",
        name: column,
        numberFormat: "",
        deleted: false,
      });
    }
  });

  for (const col of columns) {
    if (col.numberFormat === undefined) {
      col.numberFormat = "";
    }

    Object.assign(col, normalizePersistedColumn(col));
  }

  return columns;
}

/**
 * Runs the top-values query for a fact table's eligible columns and returns
 * an update for each column queried successfully. It doesn't change
 * `detectedColumns`; callers save the updates with `updateColumnsTopValues`.
 */
export async function refreshColumnTopValues(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<
    FactTableInterface,
    "sql" | "eventName" | "userIdTypes" | "userIdColumns" | "timestampColumn"
  > & {
    id: string | null;
  },
  detectedColumns: ColumnInterface[],
): Promise<TopValuesUpdate[]> {
  const updates: TopValuesUpdate[] = [];
  const columnsNeedingTopValues = selectColumnsForTopValues({
    columns: detectedColumns,
    userIdTypes: factTable.userIdTypes,
    userIdColumns: factTable.userIdColumns,
  });

  // Batch query for all columns that need top values. Datasources
  // scan the fact table once per chunk, so we batch aggressively (25
  // columns * ~100 values = ~2500 rows per chunk).
  if (columnsNeedingTopValues.length > 0) {
    const columnChunks = chunk(columnsNeedingTopValues, TOP_VALUES_CHUNK_SIZE);

    for (const columnChunk of columnChunks) {
      try {
        const countsByColumn = await runColumnsTopValueCountsQuery(
          context,
          datasource,
          // The query resolves JSON field paths against the freshly
          // detected columns.
          { ...factTable, columns: detectedColumns },
          columnChunk,
        );

        // Process results for each column
        for (const col of columnChunk) {
          const values = countsByColumn[col.column] || [];
          updates.push({
            column: col.column,
            snapshot: { values, refreshedAt: new Date() },
            slices: "fill",
          });
        }
      } catch (e) {
        logger.error(
          e,
          `Error running top values query on ${datasource.type}`,
          {
            columns: columnChunk.map((c) => c.column),
          },
        );
      }
    }
  }

  return updates;
}
