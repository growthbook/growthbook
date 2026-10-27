import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  DetectedColumn,
  FactFilterTestResults,
  RowFilter,
  RowFilterTestResults,
} from "shared/types/fact-table";
import {
  Column,
  InformationSchemaTablesInterface,
} from "shared/types/integrations";
import { mapDatabaseTypeToEnum } from "shared/enterprise";
import { getDataSourceSqlDialect } from "shared/dialects";
import { buildRowFilterWhereClause } from "shared/experiments";
import type { TestQueryType } from "shared/types/query";
import {
  columnTypesToColumnSource,
  FilterColumnSource,
  isRowFilterComplete,
} from "@/components/FactTables/rowFilterUtils";
import { useAuth } from "@/services/auth";
import {
  getDefaultPartitionColumn,
  getPartitionFormats,
  getPickerTableColumns,
  getPickerTableName,
  getPickerTableSql,
  haveSameColumnNames,
  isPseudoColumn,
  SourceTableTemplate,
} from "@/services/factTables";
import { SchemaBrowserTable } from "@/services/schemaBrowserTables";
import useApi from "@/hooks/useApi";

export const SAMPLE_ROW_LIMIT = 20;

// Warehouses that skip partitions a WHERE rules out, so a filter saves cost
const PARTITION_PRUNING_TYPES = ["bigquery", "athena", "databricks", "presto"];

export type SourceMode = "table" | "sql";

export type SourceTable = ReturnType<typeof useSourceTable>;

export function useSourceTable({
  datasource,
  tableModeAvailable,
  templates,
  queryType,
  sql,
  setSql,
  initialColumns = null,
  getColumnMappingError,
  columnSelection,
  onSelectTable,
  onColumnsChanged,
}: {
  datasource: DataSourceInterfaceWithParams | null | undefined;
  tableModeAvailable: boolean;
  templates: SourceTableTemplate[];
  queryType: TestQueryType;
  // SQL mode's query; switching to SQL mode seeds it with the generated SQL
  sql: string;
  setSql: (sql: string) => void;
  // Columns already known for `sql`, e.g. a saved query's
  initialColumns?: DetectedColumn[] | null;
  getColumnMappingError: (
    columns: DetectedColumn[],
    fromTable?: boolean,
  ) => string | null;
  // Removing no columns generates SELECT *; mapped columns are never removed
  columnSelection?: { mapped: string[]; removed: string[] };
  onSelectTable: (tableName: string) => void;
  // Called when the detected columns change, not when only their types do
  onColumnsChanged: (columns: DetectedColumn[]) => void;
}) {
  const { apiCall } = useAuth();
  const datasourceId = datasource?.id ?? "";
  const datasourceType = datasource?.type;

  const [preferredMode, setPreferredMode] = useState<SourceMode>("table");
  const mode = tableModeAvailable ? preferredMode : "sql";
  const [selectedTable, setSelectedTable] = useState<SchemaBrowserTable | null>(
    null,
  );
  const [rowFilters, setRowFilters] = useState<RowFilter[]>([]);
  // Null until the user picks one; an empty column means no partition filter
  const [partitionChoice, setPartitionChoice] = useState<{
    column: string;
    format: string;
  } | null>(null);
  const [unlistedColumns, setUnlistedColumns] = useState<{
    columns?: Column[];
    error?: string;
  } | null>(null);
  const [detected, setDetected] = useState(initialColumns);
  const [detectedSql, setDetectedSql] = useState<string | null>(
    initialColumns ? sql : null,
  );

  const onColumnsChangedRef = useRef(onColumnsChanged);
  onColumnsChangedRef.current = onColumnsChanged;
  const handleColumnsDetected = useCallback(
    (columns: DetectedColumn[], ranSql: string | null = null) => {
      setDetectedSql(ranSql);
      setDetected(columns);
      if (!detected || !haveSameColumnNames(detected, columns)) {
        onColumnsChangedRef.current(columns);
      }
    },
    [detected],
  );

  useEffect(() => {
    setSelectedTable(null);
    setRowFilters([]);
    setPartitionChoice(null);
    setUnlistedColumns(null);
  }, [datasourceId]);

  const findTemplate = (table: SchemaBrowserTable) =>
    templates.find((t) => t.matches(table)) ?? null;
  const template = selectedTable ? findTemplate(selectedTable) : null;
  const tableName = selectedTable
    ? getPickerTableName(selectedTable, template)
    : null;

  const selectTable = (table: SchemaBrowserTable) => {
    // Unlisted tables share an empty id
    if (table.path === selectedTable?.path) return;
    onSelectTable(getPickerTableName(table, findTemplate(table)));
    setSelectedTable(table);
    setDetected(null);
    setUnlistedColumns(null);
    setRowFilters([]);
    setPartitionChoice(null);
  };

  const {
    data: tableData,
    error: tableDataError,
    isValidating: validatingTableData,
    mutate: mutateTableData,
  } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasourceId}/schema/table/${selectedTable?.id}`, {
    shouldRun: () => !!selectedTable?.id,
  });

  // A table the information schema doesn't list gets its columns from a
  // LIMIT 0 query instead
  const unlistedPath =
    selectedTable && !selectedTable.id ? selectedTable.path : null;
  const [unlistedAttempt, setUnlistedAttempt] = useState(0);
  useEffect(() => {
    if (!unlistedPath) return;
    let cancelled = false;
    apiCall<{ error?: string; columns?: DetectedColumn[] }>("/query/test", {
      method: "POST",
      body: JSON.stringify({
        query: `SELECT * FROM ${unlistedPath}`,
        datasourceId,
        limit: 0,
        detectColumns: true,
        queryType,
      }),
    })
      .then((res) => ({
        error: res.error,
        // Detected types are already enum values, which map to themselves
        columns: res.columns?.map((c) => ({
          columnName: c.column,
          dataType: c.datatype,
        })),
      }))
      .catch((e) => ({ error: e.message, columns: undefined }))
      .then((result) => {
        if (!cancelled) setUnlistedColumns(result);
      });
    return () => {
      cancelled = true;
    };
  }, [unlistedPath, datasourceId, apiCall, unlistedAttempt, queryType]);

  const tableColumns = unlistedPath
    ? (unlistedColumns?.columns ?? null)
    : (tableData?.table.columns ?? null);
  // Hidden while SWR retries, so the retry shows as loading
  const tableColumnsError = unlistedPath
    ? (unlistedColumns?.error ?? null)
    : validatingTableData
      ? null
      : (tableDataError?.message ?? null);
  // Either way it's a warehouse query, which can take a few seconds
  const loadingColumns =
    mode === "table" && !!selectedTable && !tableColumns && !tableColumnsError;
  const retryColumns = () => {
    if (unlistedPath) {
      setUnlistedColumns(null);
      setUnlistedAttempt((n) => n + 1);
    } else {
      mutateTableData();
    }
  };
  // Re-reads the columns from the warehouse instead of the cached copy.
  // Unlisted tables aren't cached, and a table still loading has no copy yet.
  const refreshColumns = async () => {
    if (!selectedTable) return;
    if (unlistedPath || !tableData) return retryColumns();
    const res = await apiCall<{ table: InformationSchemaTablesInterface }>(
      `/datasource/${datasourceId}/schema/table/${selectedTable.id}`,
      { method: "PUT" },
    );
    await mutateTableData({ table: res.table }, false);
  };

  const columnTypes = useMemo(
    () =>
      Object.fromEntries(
        (tableColumns ?? []).map((c) => [
          c.columnName,
          mapDatabaseTypeToEnum(c.dataType),
        ]),
      ),
    [tableColumns],
  );
  // Complex types can't be compared with a literal, so filters leave them out
  const columnSource: FilterColumnSource | null = useMemo(
    () =>
      tableColumns
        ? columnTypesToColumnSource(
            Object.fromEntries(
              Object.entries(columnTypes).filter(([, t]) => t !== "other"),
            ),
          )
        : null,
    [tableColumns, columnTypes],
  );

  // Pseudo-columns still feed the partition filter and row filters
  const outputColumns = useMemo(
    () =>
      tableColumns?.filter((c) => !isPseudoColumn(c, datasourceType)) ?? null,
    [tableColumns, datasourceType],
  );

  // Table mode reads columns from the information schema instead of querying
  const pickerColumns = useMemo(
    () =>
      selectedTable && outputColumns
        ? (template?.columns ?? getPickerTableColumns(outputColumns))
        : null,
    [selectedTable, outputColumns, template],
  );
  useEffect(() => {
    if (mode === "table" && pickerColumns) {
      handleColumnsDetected(pickerColumns);
    }
  }, [mode, pickerColumns, handleColumnsDetected]);

  const columnNames = (outputColumns ?? []).map((c) => c.columnName);
  const otherColumns = columnNames.filter(
    (c) => !columnSelection?.mapped.includes(c),
  );
  const additionalColumns = otherColumns.filter(
    (c) => !columnSelection?.removed.includes(c),
  );
  const sqlColumns =
    additionalColumns.length === otherColumns.length
      ? []
      : columnNames.filter(
          (c) =>
            columnSelection?.mapped.includes(c) ||
            additionalColumns.includes(c),
        );

  const dialect = datasource ? getDataSourceSqlDialect(datasource.type) : null;
  const compileRowFilters = (filters: RowFilter[]) => {
    if (!filters.length) return "";
    if (!dialect) {
      throw new Error("Row filters are not supported on this Data Source");
    }
    const now = new Date();
    return buildRowFilterWhereClause({
      rowFilters: filters,
      factTable: {
        columns: Object.entries(columnTypes).map(([column, datatype]) => ({
          column,
          datatype,
          name: column,
          description: "",
          numberFormat: "",
          deleted: false,
          dateCreated: now,
          dateUpdated: now,
        })),
        filters: [],
        userIdTypes: [],
      },
      dialect,
    });
  };

  // Null while the filters are incomplete or invalid
  let rowFilterWhere: string | null = null;
  let rowFilterError: string | null = null;
  if (rowFilters.every(isRowFilterComplete)) {
    try {
      rowFilterWhere = compileRowFilters(rowFilters);
    } catch (e) {
      rowFilterError = e.message;
    }
  }

  // Pseudo-columns can be picked too: they work in a WHERE
  const partitionOptions = Object.entries(columnTypes)
    .filter(([, datatype]) => datatype !== "boolean")
    .map(([column, datatype]) => ({ column, datatype }));
  const partitionColumn =
    partitionChoice?.column ??
    getDefaultPartitionColumn(tableColumns ?? [], datasourceType);
  const partitionType = columnTypes[partitionColumn] ?? "";
  const partitionFormats = getPartitionFormats(partitionType);
  const partitionFormat =
    partitionChoice && partitionFormats.includes(partitionChoice.format)
      ? partitionChoice.format
      : (partitionFormats[0] ?? "");

  const buildTableSql = (where: string) => {
    if (!selectedTable) return "";
    if (template) return template.getSql(selectedTable, where);
    return getPickerTableSql(selectedTable, {
      partition: {
        column: partitionColumn,
        datatype: partitionType,
        format: partitionFormat,
      },
      datasourceType,
      identifierQuote: dialect?.identifierQuote,
      columns: sqlColumns,
      rowFilterWhere: where,
    });
  };
  const tableSql = buildTableSql(rowFilterWhere ?? "");

  const testRowFilters = async (
    filters: RowFilter[],
  ): Promise<RowFilterTestResults> => {
    const where = compileRowFilters(filters);
    const generatedSql = buildTableSql(where);
    const res = await apiCall<FactFilterTestResults>("/query/test", {
      method: "POST",
      body: JSON.stringify({
        query: generatedSql,
        datasourceId,
        limit: SAMPLE_ROW_LIMIT,
        queryType,
      }),
    });
    return { ...res, where, generatedSql };
  };

  const setMode = (next: SourceMode) => {
    if (next === "sql" && selectedTable) setSql(tableSql);
    setPreferredMode(next);
  };

  const querySql = mode === "table" ? tableSql : sql;
  const hasFreshResults = detectedSql === querySql && !!detected?.length;
  const columnError =
    mode === "table"
      ? pickerColumns
        ? getColumnMappingError(pickerColumns, true)
        : null
      : hasFreshResults && detected
        ? getColumnMappingError(detected)
        : null;

  return {
    datasourceId,
    queryType,
    querySql,
    setSql,
    detected,
    handleColumnsDetected,
    hasFreshResults,
    columnError,
    getColumnMappingError,
    // Table mode needs the columns loaded and complete filters; SQL mode is
    // validated when the step is submitted
    canContinue:
      !columnError &&
      (mode === "sql" || (!!pickerColumns && rowFilterWhere !== null)),
    backToTableMode:
      mode === "sql" && tableModeAvailable ? () => setMode("table") : undefined,
    mode,
    setMode,
    tableModeAvailable,
    selectedTable,
    selectTable,
    template,
    tableName,
    tableColumnsError,
    loadingColumns,
    retryColumns,
    refreshColumns,
    columnTypes,
    columnSource,
    pickerColumns,
    otherColumns,
    additionalColumns,
    sqlColumns,
    rowFilters,
    setRowFilters,
    rowFilterWhere,
    rowFilterError,
    testRowFilters,
    partition: {
      available:
        PARTITION_PRUNING_TYPES.includes(datasourceType ?? "") ||
        !!tableColumns?.some((c) => c.isPartition),
      column: partitionColumn,
      format: partitionFormat,
      options: partitionOptions,
      formats: partitionFormats,
      setColumn: (column: string) =>
        setPartitionChoice({ column, format: partitionFormat }),
      setFormat: (format: string) =>
        setPartitionChoice({ column: partitionColumn, format }),
    },
    tableSql,
  };
}
