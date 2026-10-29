import {
  MutableRefObject,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  PiArrowClockwise,
  PiArrowRight,
  PiDotsThreeVertical,
  PiPlay,
  PiWarningFill,
} from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  InformationSchemaInterfaceWithPaths,
  TestQueryRow,
} from "shared/types/integrations";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ago } from "shared/dates";
import { DetectedColumn } from "shared/types/fact-table";
import {
  isManagedWarehouseUnavailable,
  parseIntWithDefault,
} from "shared/util";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import {
  getSchemaBrowserTables,
  getUnlistedTable,
  SchemaBrowserTable,
} from "@/services/schemaBrowserTables";
import useApi from "@/hooks/useApi";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import { TestQueryResultsTable } from "@/components/Settings/DisplayTestQueryResults";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import { RowFilterActions } from "@/components/FactTables/RowFilterActions";
import { RowFilterEditorRows } from "@/components/FactTables/RowFilterFields";
import { RowFilterSampleRowsModal } from "@/components/FactTables/SampleRowsModal";
import { isRowFilterComplete } from "@/components/FactTables/rowFilterUtils";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import AreaWithHeader from "@/components/SchemaBrowser/AreaWithHeader";
import useSqlAutocomplete from "@/components/SchemaBrowser/useSqlAutocomplete";
import {
  SAMPLE_ROW_LIMIT,
  SourceTable,
} from "@/components/SchemaBrowser/useSourceTable";
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";
import { canFormatSql, formatSql } from "@/services/sqlFormatter";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";

const panelBorder = {
  border: "1px solid var(--gray-a3)",
  borderRadius: "var(--radius-4)",
};

function TablePicker({
  datasource,
  selectedTable,
  onSelectTable,
  refreshColumns,
}: {
  datasource: DataSourceInterfaceWithParams;
  selectedTable: SchemaBrowserTable | null;
  onSelectTable: (table: SchemaBrowserTable) => void;
  refreshColumns: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canRunQueries = permissionsUtil.canRunSchemaQueries(datasource);
  const canListTables = !!datasource.properties?.supportsInformationSchema;
  const managedWarehousePending = isManagedWarehouseUnavailable(datasource);

  // A refresh is marked PENDING before the request returns, but a new schema
  // has no record to watch until its background job creates one
  const [creating, setCreating] = useState(false);
  const {
    data,
    error: fetchError,
    isValidating,
    mutate,
  } = useApi<{
    informationSchema: InformationSchemaInterfaceWithPaths;
  }>(`/datasource/${datasource.id}/schema`, {
    shouldRun: () => !managedWarehousePending,
    refreshInterval: (latest) =>
      latest?.informationSchema?.status === "PENDING" ||
      (creating && !latest?.informationSchema)
        ? 2000
        : 0,
  });
  const informationSchema = data?.informationSchema;
  const building =
    (creating && !informationSchema) || informationSchema?.status === "PENDING";

  const [error, setError] = useState<string | null>(null);
  const [refreshingColumns, setRefreshingColumns] = useState(false);
  const schemaError =
    error || fetchError?.message || informationSchema?.error?.message || null;
  const refreshLabel = schemaError
    ? "Retry loading tables"
    : !informationSchema
      ? "Load tables"
      : selectedTable
        ? "Refresh tables and columns"
        : "Refresh tables";

  const buildSchema = async () => {
    setError(null);
    setRefreshingColumns(true);
    try {
      await Promise.all([
        apiCall(`/datasource/${datasource.id}/schema`, {
          method: informationSchema ? "PUT" : "POST",
          body: JSON.stringify({ informationSchemaId: informationSchema?.id }),
        }).then(() => {
          if (!informationSchema) setCreating(true);
          return mutate();
        }),
        refreshColumns(),
      ]);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshingColumns(false);
    }
  };

  const groups = useMemo(() => {
    const databases = informationSchema?.databases ?? [];
    return databases.flatMap((database) =>
      database.schemas.map((schema) => ({
        label: schema.path.replace(/`/g, "") || schema.schemaName,
        tables: getSchemaBrowserTables(schema, datasource.type === "bigquery"),
      })),
    );
  }, [informationSchema, datasource.type]);
  const tablesById = useMemo(
    () =>
      new Map(
        groups.flatMap((g) =>
          g.tables.map((t) => [t.id, { table: t, group: g.label }]),
        ),
      ),
    [groups],
  );

  let content: React.ReactNode;
  if (managedWarehousePending) {
    content = <ManagedWarehouseNoEventsCallout size="sm" />;
  } else if (!data && !fetchError) {
    content = <LoadingSpinner />;
  } else {
    content = (
      <SelectField
        value={selectedTable?.id || selectedTable?.path || ""}
        onChange={(value) => {
          const entry = tablesById.get(value);
          if (entry) onSelectTable(entry.table);
          else if (value.trim()) onSelectTable(getUnlistedTable(value.trim()));
        }}
        createable
        // Commits typed tables on blur or Enter, not per keystroke, and stays
        // the same input if tables finish loading mid-edit
        keepCreatableWhenEmpty
        formatCreateLabel={(input) => `Use table "${input}"`}
        options={groups.map((g) => ({
          label: g.label,
          options: g.tables.map((t) => ({
            value: t.id,
            label: t.shards
              ? `${t.tableName} (${t.shards} tables)`
              : t.tableName,
          })),
        }))}
        formatOptionLabel={({ value, label }, { context }) => {
          const entry = tablesById.get(value);
          if (!entry) return label;
          return (
            <Flex
              justify="between"
              align="center"
              gap="3"
              py={context === "value" ? "1" : undefined}
            >
              <Flex direction="column" minWidth="0">
                <Text as="div" size="md" truncate>
                  {label}
                </Text>
                <Text as="div" size="sm" color="text-low" truncate>
                  {entry.group}
                </Text>
              </Flex>
              <Text size="sm" color="text-low" whiteSpace="nowrap">
                {entry.table.numOfColumns} columns
              </Text>
            </Flex>
          );
        }}
        placeholder={
          tablesById.size
            ? "Search tables..."
            : "Enter a table, like analytics.events"
        }
        size="md"
        autoFocus
      />
    );
  }

  return (
    <Box>
      <Flex align="center" justify="between" mb="1">
        <Text weight="semibold">Source table</Text>
        {managedWarehousePending ? null : (
          <Flex align="center" gap="2">
            {informationSchema && tablesById.size && !building ? (
              <Text size="sm" color="text-low">
                Updated {ago(informationSchema.dateUpdated)}
              </Text>
            ) : null}
            <Tooltip
              style={{ display: "flex" }}
              body={
                <>
                  {schemaError ? (
                    <Text as="div" mb="1">
                      {schemaError}
                    </Text>
                  ) : null}
                  {building
                    ? "Loading tables. This can take a minute."
                    : data && !canListTables
                      ? "This Data Source can't list tables. Enter a table name instead."
                      : data && !canRunQueries
                        ? "You don't have permission to load tables for this Data Source."
                        : refreshLabel}
                </>
              }
            >
              <IconButton
                type="button"
                variant="ghost"
                size="1"
                color={schemaError ? "red" : undefined}
                aria-label={refreshLabel}
                loading={
                  building ||
                  refreshingColumns ||
                  (!!fetchError && isValidating)
                }
                // Without the schema there's nothing to rebuild, so a failed
                // load retries the load itself
                disabled={data ? !canRunQueries || !canListTables : !fetchError}
                onClick={data ? buildSchema : () => mutate()}
              >
                <PiArrowClockwise />
              </IconButton>
            </Tooltip>
          </Flex>
        )}
      </Flex>
      {content}
    </Box>
  );
}

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
  columns?: DetectedColumn[];
};

export default function SourceStep({
  source,
  validateRef,
  placeholder,
  datasourceHeader,
  tableHint,
}: {
  source: SourceTable;
  validateRef: MutableRefObject<(() => Promise<void>) | null>;
  placeholder: string;
  // Shown above the table picker or the SQL editor, e.g. a Data Source picker
  datasourceHeader?: ReactNode;
  // Shown under the picked table's filters
  tableHint?: ReactNode;
}) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const {
    datasourceId,
    queryType,
    querySql: sql,
    setSql,
    detected,
    handleColumnsDetected: onColumnsDetected,
    hasFreshResults,
    columnError,
    getColumnMappingError,
    mode,
    setMode,
    selectedTable,
    selectTable,
    tableColumnsError,
    loadingColumns,
    retryColumns,
    refreshColumns,
    rowFilters,
    setRowFilters,
    columnSource,
    testRowFilters,
    rowFilterError,
  } = source;
  const permissionsUtil = usePermissionsUtil();

  const [testQueryResults, setTestQueryResults] =
    useState<TestQueryResults | null>(null);
  const [testingQuery, setTestingQuery] = useState(false);
  const [sampleRowsOpen, setSampleRowsOpen] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const {
    autoCompletions,
    isAutocompleteEnabled,
    setCursorData,
    setIsAutocompleteEnabled,
  } = useSqlAutocomplete({
    datasourceId,
    source: "EditSqlModal",
  });

  const datasource = getDatasourceById(datasourceId);
  const canRunQueries = datasource
    ? permissionsUtil.canRunTestQueries(datasource)
    : false;
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;
  const canFormat = datasource ? canFormatSql(datasource.type) : false;

  const runQuery = useCallback(
    async (limit: number): Promise<TestQueryResults> => {
      setTestingQuery(true);
      try {
        validateSQL(sql, []);
        const res = await apiCall<TestQueryResults>("/query/test", {
          method: "POST",
          body: JSON.stringify({
            query: sql,
            datasourceId,
            limit,
            detectColumns: true,
            queryType,
          }),
        });
        const results = { ...res, error: res.error || "" };
        // A `LIMIT 0` validation run has no rows to show, and the pane's
        // contents belong to the SQL the user just edited away from.
        setTestQueryResults(limit || results.error ? results : null);
        if (!results.error) {
          onColumnsDetected(results.columns || [], sql);
        }
        return results;
      } catch (e) {
        const results = { sql, error: e.message };
        setTestQueryResults(results);
        return results;
      } finally {
        setTestingQuery(false);
      }
    },
    [apiCall, datasourceId, sql, onColumnsDetected, queryType],
  );

  useEffect(() => {
    validateRef.current = async () => {
      if (mode === "table") return;
      if (hasFreshResults) {
        if (columnError) throw new Error(columnError);
        return;
      }
      const results = await runQuery(0);
      if (results.error || !results.columns?.length) throw new Error("");
      const error = getColumnMappingError(results.columns);
      if (error) throw new Error(error);
    };
    return () => {
      validateRef.current = null;
    };
  }, [
    validateRef,
    hasFreshResults,
    columnError,
    runQuery,
    mode,
    getColumnMappingError,
  ]);

  const sqlEditor = (
    <AreaWithHeader
      header={
        <Flex align="center" justify="between">
          <Text weight="semibold" color="text-mid">
            SQL
          </Text>
          <Flex gap="3" align="center">
            {formatError && (
              <Tooltip body={formatError}>
                <PiWarningFill color="var(--red-11)" />
              </Tooltip>
            )}
            {canFormat ? (
              <Button
                size="md"
                variant="ghost"
                onClick={() => {
                  const result = formatSql(sql, datasource?.type);
                  if (result.error) {
                    setFormatError(result.error);
                  } else if (result.formattedSql) {
                    setSql(result.formattedSql);
                    setFormatError(null);
                  }
                }}
                disabled={!sql}
              >
                Format
              </Button>
            ) : null}
            <Tooltip
              body={
                canRunQueries
                  ? `Runs a LIMIT ${SAMPLE_ROW_LIMIT} query, which may trigger a full table scan`
                  : "You do not have permission to run test queries"
              }
            >
              <Button
                size="md"
                variant="soft"
                icon={<PiPlay />}
                onClick={() => runQuery(SAMPLE_ROW_LIMIT)}
                loading={testingQuery}
                disabled={!canRunQueries || !sql}
              >
                Test Query
              </Button>
            </Tooltip>
            <DropdownMenu
              trigger={
                <IconButton variant="ghost" color="gray" radius="full" size="3">
                  <PiDotsThreeVertical size={16} />
                </IconButton>
              }
            >
              <DropdownMenuItem
                onClick={() => setIsAutocompleteEnabled(!isAutocompleteEnabled)}
              >
                {isAutocompleteEnabled
                  ? "Disable autocomplete"
                  : "Enable autocomplete"}
              </DropdownMenuItem>
            </DropdownMenu>
          </Flex>
        </Flex>
      }
    >
      <Box height="100%">
        <CodeTextArea
          wrapperClassName={styles["sql-editor-wrapper"]}
          language="sql"
          value={sql}
          setValue={(v) => {
            if (formatError) setFormatError(null);
            setSql(v);
          }}
          placeholder={placeholder}
          fullHeight
          setCursorData={setCursorData}
          onCtrlEnter={() => runQuery(SAMPLE_ROW_LIMIT)}
          onEditorLoad={(editor) => editor.focus()}
          completions={autoCompletions}
        />
      </Box>
    </AreaWithHeader>
  );

  const resultsTable = testQueryResults ? (
    <TestQueryResultsTable
      compact
      duration={parseIntWithDefault(testQueryResults.duration, 0)}
      results={testQueryResults.results || []}
      sql={testQueryResults.sql || ""}
      error={testQueryResults.error || ""}
      onClose={() => setTestQueryResults(null)}
    />
  ) : null;

  const callouts = (
    <>
      {columnError ? (
        <Callout status="error" size="sm">
          {columnError}
        </Callout>
      ) : null}
      {testQueryResults && !testQueryResults.error && !detected?.length && (
        <Callout status="warning" size="sm">
          Your warehouse reported no output columns for this query. Double-check
          the SQL, then run it again.
        </Callout>
      )}
    </>
  );

  if (mode === "table" && datasource) {
    return (
      <Flex direction="column" gap="4" px="2">
        <Callout
          status="info"
          size="sm"
          action={
            <Button
              size="sm"
              variant="ghost"
              color="inherit"
              icon={<PiArrowRight />}
              iconPosition="right"
              onClick={() => setMode("sql")}
            >
              Switch to SQL mode
            </Button>
          }
        >
          Need joins or complex logic?
        </Callout>
        {datasourceHeader}
        <TablePicker
          key={datasource.id}
          datasource={datasource}
          selectedTable={selectedTable}
          onSelectTable={selectTable}
          refreshColumns={refreshColumns}
        />
        {tableColumnsError ? (
          <Callout
            status="error"
            size="sm"
            action={
              <Button
                size="sm"
                variant="ghost"
                color="inherit"
                onClick={retryColumns}
              >
                Retry
              </Button>
            }
          >
            {tableColumnsError}
          </Callout>
        ) : null}
        <Flex direction="column" gap="2">
          {rowFilters.length ? <Text weight="semibold">Filters</Text> : null}
          {columnSource ? (
            <RowFilterEditorRows
              value={rowFilters}
              setValue={setRowFilters}
              columnSource={columnSource}
              dateInputWidth={260}
            />
          ) : null}
          {loadingColumns ? (
            <Flex align="center" gap="2">
              <LoadingSpinner />
              <Text size="sm" color="text-low">
                Loading columns...
              </Text>
            </Flex>
          ) : (
            <RowFilterActions
              disabled={!columnSource}
              onAdd={(filter) => setRowFilters([...rowFilters, filter])}
              onViewSampleRows={
                canRunQueries && selectedTable
                  ? () => setSampleRowsOpen(true)
                  : undefined
              }
              canViewSampleRows={
                !!columnSource && rowFilters.every(isRowFilterComplete)
              }
            />
          )}
          {rowFilterError ? (
            <Callout status="error" size="sm">
              {rowFilterError}
            </Callout>
          ) : null}
          {tableHint}
        </Flex>
        {sampleRowsOpen && selectedTable ? (
          <RowFilterSampleRowsModal
            title={[selectedTable.schemaName, selectedTable.tableName]
              .filter(Boolean)
              .join(".")}
            columnSource={columnSource}
            testRowFilters={testRowFilters}
            rowFilters={rowFilters}
            setRowFilters={setRowFilters}
            close={() => setSampleRowsOpen(false)}
          />
        ) : null}
        {callouts}
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2" height="100%">
      {datasourceHeader ? <Box width="320px">{datasourceHeader}</Box> : null}
      <Box flexGrow="1" style={{ minHeight: 0 }}>
        <PanelGroup direction="horizontal">
          <Panel defaultSize={70}>
            <PanelGroup direction="vertical">
              <Panel
                id="main"
                order={1}
                defaultSize={testQueryResults ? 50 : 100}
                minSize={20}
              >
                {sqlEditor}
              </Panel>
              {resultsTable ? (
                <>
                  <PanelResizeHandle />
                  <Panel id="results" order={2} defaultSize={50} minSize={20}>
                    <Flex direction="column" height="100%">
                      {resultsTable}
                    </Flex>
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </Panel>
          <PanelResizeHandle />
          <Panel defaultSize={30} minSize={20} maxSize={50}>
            {datasource && supportsSchemaBrowser ? (
              <Flex direction="column" height="100%">
                <SchemaBrowser
                  datasource={datasource}
                  updateSqlInput={setSql}
                  sql={sql}
                />
              </Flex>
            ) : (
              <Box p="4" style={panelBorder} height="100%">
                <Text size="sm" color="text-mid">
                  This Data Source does not support browsing schemas.
                </Text>
              </Box>
            )}
          </Panel>
        </PanelGroup>
      </Box>
      {callouts}
    </Flex>
  );
}
