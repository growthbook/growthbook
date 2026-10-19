import { useEffect, useMemo, useState } from "react";
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
  getPickerTableSql,
  isPseudoColumn,
  SourceTableTemplate,
} from "@/services/factTables";
import { SchemaBrowserTable } from "@/services/schemaBrowserTables";
import useApi from "@/hooks/useApi";

export const SAMPLE_ROW_LIMIT = 20;

export type SourceMode = "table" | "sql";

export type SourceTable = ReturnType<typeof useSourceTable>;

export const findTableTemplate = (
  templates: SourceTableTemplate[],
  table: SchemaBrowserTable,
) => templates.find((t) => t.matches(table)) ?? null;

// Table mode builds the SQL from a picked table, its row filters and a
// partition filter, reading columns from the information schema.
export function useSourceTable({
  datasource,
  tableModeAvailable,
  initialMode = "table",
  templates = [],
  selectColumns,
  setSql,
  onSelectTable,
  onColumnsDetected,
}: {
  datasource: DataSourceInterfaceWithParams | null | undefined;
  tableModeAvailable: boolean;
  initialMode?: SourceMode;
  templates?: SourceTableTemplate[];
  // The columns to SELECT from the table's columns; empty selects every one
  selectColumns: (columnNames: string[]) => string[];
  // Switching to SQL mode seeds the editor with the generated SQL
  setSql: (sql: string) => void;
  onSelectTable: (table: SchemaBrowserTable) => void;
  onColumnsDetected: (columns: DetectedColumn[], sql: null) => void;
}) {
  const { apiCall } = useAuth();
  const datasourceId = datasource?.id ?? "";
  const datasourceType = datasource?.type;

  const [preferredMode, setPreferredMode] = useState<SourceMode>(initialMode);
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

  useEffect(() => {
    setSelectedTable(null);
    setRowFilters([]);
    setPartitionChoice(null);
    setUnlistedColumns(null);
  }, [datasourceId]);

  const template = selectedTable
    ? findTableTemplate(templates, selectedTable)
    : null;

  const selectTable = (table: SchemaBrowserTable) => {
    // Unlisted tables share an empty id
    if (table.path === selectedTable?.path) return;
    onSelectTable(table);
    setSelectedTable(table);
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
  }, [unlistedPath, datasourceId, apiCall, unlistedAttempt]);

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
      onColumnsDetected(pickerColumns, null);
    }
  }, [mode, pickerColumns, onColumnsDetected]);

  const columnNames = (outputColumns ?? []).map((c) => c.columnName);
  const sqlColumns = selectColumns(columnNames);

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
    const res = await apiCall<FactFilterTestResults>("/query/test", {
      method: "POST",
      body: JSON.stringify({
        query: buildTableSql(where),
        datasourceId,
        limit: SAMPLE_ROW_LIMIT,
      }),
    });
    return { ...res, where };
  };

  const setMode = (next: SourceMode) => {
    if (next === "sql" && selectedTable) setSql(tableSql);
    setPreferredMode(next);
  };

  return {
    mode,
    setMode,
    tableModeAvailable,
    selectedTable,
    selectTable,
    template,
    tableColumnsError,
    loadingColumns,
    retryColumns,
    refreshColumns,
    columnTypes,
    columnNames,
    columnSource,
    pickerColumns,
    sqlColumns,
    rowFilters,
    setRowFilters,
    rowFilterWhere,
    rowFilterError,
    testRowFilters,
    partition: {
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
