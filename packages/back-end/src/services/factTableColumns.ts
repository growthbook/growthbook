import chunk from "lodash/chunk";
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
  FactTableColumnType,
  FactTableInterface,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { ReqContext } from "back-end/types/request";
import {
  columnNamesMatch,
  type DetectedJSONFields,
  determineColumnTypes,
  getColumnByName,
  mergeJsonFields,
} from "back-end/src/util/sql";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { normalizePersistedColumn } from "back-end/src/util/factTable";
import { logger } from "back-end/src/util/logger";

export const MAX_COLUMNS_WITH_TOP_VALUES = 50;
export const MAX_TOP_VALUE_LENGTH = 100;
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
  maxColumns = MAX_COLUMNS_WITH_TOP_VALUES,
}: {
  columns: ColumnInterface[];
  userIdTypes: string[];
  maxColumns?: number;
}): ColumnInterface[] {
  const factTableLike = { columns, userIdTypes };

  const eligible = columns.filter(
    (col) =>
      col.datatype === "string" &&
      !col.deleted &&
      // Virtual columns aren't real columns in the SQL, so a top-values query
      // keyed on their name would be invalid.
      !col.isVirtual &&
      canInlineFilterColumn(factTableLike, col.column),
  );

  const alwaysCaptured = eligible.filter(
    (c) => c.alwaysInlineFilter || c.isAutoSliceColumn,
  );

  const remainingSlots = Math.max(0, maxColumns - alwaysCaptured.length);
  const newlyCaptured = eligible
    .filter((c) => !c.alwaysInlineFilter && !c.isAutoSliceColumn)
    .slice(0, remainingSlots);

  return [...alwaysCaptured, ...newlyCaptured];
}

export async function runColumnsTopValuesQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<FactTableInterface, "sql" | "eventName" | "timestampColumn">,
  columns: ColumnInterface[],
  options?: {
    limit?: number;
    searchTerm?: string;
  },
): Promise<Record<string, string[]>> {
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

  const sql = integration.getColumnsTopValuesQuery({
    factTable,
    columns,
    limit:
      options?.limit ??
      Math.max(
        100,
        context.org.settings?.maxMetricSliceLevels ??
          DEFAULT_MAX_METRIC_SLICE_LEVELS,
      ),
    lookbackDays: getTopValuesLookbackDays(
      context.org.settings?.topValuesLookbackValue ??
        DEFAULT_TOP_VALUES_LOOKBACK_VALUE,
      context.org.settings?.topValuesLookbackUnit ??
        DEFAULT_TOP_VALUES_LOOKBACK_UNIT,
    ),
    maxValueLength: MAX_TOP_VALUE_LENGTH,
    searchTerm: options?.searchTerm,
  });
  const result = await integration.runColumnsTopValuesQuery(sql);

  // Group results by column name
  const columnValues: Record<string, string[]> = {};
  for (const row of result.rows) {
    if (!columnValues[row.column]) {
      columnValues[row.column] = [];
    }
    columnValues[row.column].push(row.value);
  }

  return columnValues;
}

export function populateAutoSlices(
  col: ColumnInterface,
  topValues: string[],
  maxValues?: number,
): string[] {
  if (col.datatype === "boolean") {
    return ["true", "false"];
  }

  // Use existing autoSlices if they exist, otherwise use topValues up to the max
  if (col.autoSlices && col.autoSlices.length > 0) {
    return col.autoSlices;
  }
  const maxSliceLevels = maxValues ?? DEFAULT_MAX_METRIC_SLICE_LEVELS;
  const autoSlices: string[] = [];
  for (const value of topValues) {
    if (autoSlices.length >= maxSliceLevels) break;
    if (!autoSlices.includes(value)) {
      autoSlices.push(value);
    }
  }

  return autoSlices;
}

export function mergeRefreshedTopValues({
  currentColumns,
  currentUserIdTypes,
  refreshedColumns,
}: {
  currentColumns: ColumnInterface[];
  currentUserIdTypes: string[];
  refreshedColumns: ColumnInterface[];
}): ColumnInterface[] {
  const refreshedColumnsById = new Map(
    refreshedColumns.map((column) => [column.column, column]),
  );
  const eligibleCurrentColumnIds = new Set(
    selectColumnsForTopValues({
      columns: currentColumns,
      userIdTypes: currentUserIdTypes,
    }).map((column) => column.column),
  );

  return currentColumns.map((currentColumn) => {
    if (!eligibleCurrentColumnIds.has(currentColumn.column)) {
      return currentColumn;
    }

    const refreshedColumn = refreshedColumnsById.get(currentColumn.column);
    if (!refreshedColumn) {
      return currentColumn;
    }

    const updatedColumn = {
      ...currentColumn,
      topValues: refreshedColumn.topValues,
      topValuesDate: refreshedColumn.topValuesDate,
    };

    if (currentColumn.isAutoSliceColumn) {
      updatedColumn.autoSlices =
        currentColumn.autoSlices && currentColumn.autoSlices.length > 0
          ? currentColumn.autoSlices
          : refreshedColumn.autoSlices;
    }

    return updatedColumn;
  });
}

export async function runColumnDetectionQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<
    FactTableInterface,
    "sql" | "eventName" | "columns" | "userIdTypes" | "timestampColumn"
  >,
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
  );

  const typeMap = new Map<string, FactTableColumnType>();
  const jsonMap = new Map<string, DetectedJSONFields>();
  const warehouseTypeMap = new Map<string, FactTableColumnType>();

  result.columns?.forEach((col) => {
    // If the underlying SQL engine returned the datatype, use it
    if (col.dataType !== undefined) {
      warehouseTypeMap.set(col.name, col.dataType);
      // For JSON, only return if we have the field information, otherwise skip
      // so we can infer from the returned data
      if (
        col.dataType === "json" &&
        col.fields !== undefined &&
        col.fields.length > 0
      ) {
        typeMap.set(col.name, "json");
        jsonMap.set(col.name, {
          source: "querySchema",
          fields: col.fields.reduce(
            (acc, field) => ({
              ...acc,
              [field.name]: {
                datatype: field.dataType,
              },
            }),
            {},
          ),
        });
      } else if (col.dataType !== "json") {
        typeMap.set(col.name, col.dataType);
      }
    }
  });

  determineColumnTypes(result.results, typeMap).forEach((col) => {
    typeMap.set(col.column, col.datatype);
    if (col.jsonFields) {
      jsonMap.set(col.column, {
        source: "sampledValues",
        fields: col.jsonFields,
      });
    }
  });

  const columns = factTable.columns || [];

  // Update existing column
  columns.forEach((col) => {
    // Virtual columns are user-defined expressions that never appear in the
    // fact table's output schema, so they must be preserved by the refresh
    // rather than marked deleted. Their validity is recomputed below.
    if (col.isVirtual) {
      return;
    }

    const type = getColumnByName(typeMap, col.column, caseSensitive);
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
  typeMap.forEach((datatype, column) => {
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
 * Runs the top-values query for a fact table's eligible columns and mutates
 * the supplied columns with the results, returning those enriched successfully.
 */
export async function refreshColumnTopValues(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<
    FactTableInterface,
    "sql" | "eventName" | "userIdTypes" | "timestampColumn"
  >,
  columns: ColumnInterface[],
): Promise<ColumnInterface[]> {
  const refreshedColumns: ColumnInterface[] = [];
  const columnsNeedingTopValues = selectColumnsForTopValues({
    columns,
    userIdTypes: factTable.userIdTypes,
  });

  // Batch query for all columns that need top values. Datasources
  // scan the fact table once per chunk, so we batch aggressively (25
  // columns * ~100 values = ~2500 rows per chunk).
  if (columnsNeedingTopValues.length > 0) {
    const columnChunks = chunk(columnsNeedingTopValues, TOP_VALUES_CHUNK_SIZE);

    for (const columnChunk of columnChunks) {
      try {
        const topValuesByColumn = await runColumnsTopValuesQuery(
          context,
          datasource,
          factTable,
          columnChunk,
        );

        // Process results for each column
        for (const col of columnChunk) {
          const topValues = topValuesByColumn[col.column] || [];
          col.topValues = topValues;
          col.topValuesDate = new Date();

          if (col.isAutoSliceColumn) {
            col.autoSlices = populateAutoSlices(
              col,
              topValues,
              context.org.settings?.maxMetricSliceLevels,
            );
          }
          refreshedColumns.push(col);
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

  return refreshedColumns;
}
