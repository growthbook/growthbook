import {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PiArrowClockwise,
  PiArrowLeft,
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
import { DetectedFactTableColumn } from "shared/types/fact-table";
import {
  isManagedWarehouseUnavailable,
  isProjectListValidForProject,
  parseIntWithDefault,
} from "shared/util";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import { getColumnMappingError } from "@/services/factTables";
import {
  getSchemaBrowserTables,
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
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import AreaWithHeader from "@/components/SchemaBrowser/AreaWithHeader";
import BuildInformationSchemaCard from "@/components/SchemaBrowser/BuildInformationSchemaCard";
import PendingInformationSchemaCard from "@/components/SchemaBrowser/PendingInformationSchemaCard";
import RetryInformationSchemaCard from "@/components/SchemaBrowser/RetryInformationSchemaCard";
import useSqlAutocomplete from "@/components/SchemaBrowser/useSqlAutocomplete";
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";
import { canFormatSql, formatSql } from "@/services/sqlFormatter";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

const SAMPLE_ROW_LIMIT = 20;

export type FactTableSqlMode = "table" | "sql";

const panelBorder = {
  border: "1px solid var(--gray-a3)",
  borderRadius: "var(--radius-4)",
};

function TablePicker({
  datasource,
  selectedTable,
  onSelectTable,
  onSwitchToSql,
}: {
  datasource: DataSourceInterfaceWithParams;
  selectedTable: SchemaBrowserTable | null;
  onSelectTable: (table: SchemaBrowserTable) => void;
  onSwitchToSql: () => void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canRunQueries = permissionsUtil.canRunSchemaQueries(datasource);
  const managedWarehousePending = isManagedWarehouseUnavailable(datasource);

  const {
    data,
    error: fetchError,
    mutate,
  } = useApi<{
    informationSchema: InformationSchemaInterfaceWithPaths;
  }>(`/datasource/${datasource.id}/schema`, {
    shouldRun: () => !managedWarehousePending,
  });
  const informationSchema = data?.informationSchema;

  const [error, setError] = useState<string | null>(null);
  // Builds run in a background job, so fetches can return the old schema
  // for a moment. Treat it as building until the schema changes.
  const snapshot = `${informationSchema?.status}:${informationSchema?.dateUpdated}:${informationSchema?.error?.message}`;
  const [queuedFrom, setQueuedFrom] = useState<string | null>(null);
  const building =
    queuedFrom === snapshot || informationSchema?.status === "PENDING";

  const buildSchema = async (method: "PUT" | "POST") => {
    setError(null);
    try {
      await apiCall(`/datasource/${datasource.id}/schema`, {
        method,
        body: JSON.stringify({ informationSchemaId: informationSchema?.id }),
      });
      setQueuedFrom(snapshot);
    } catch (e) {
      setError(e.message);
    }
  };

  const groups = useMemo(() => {
    const databases = informationSchema?.databases ?? [];
    return databases.flatMap((database) =>
      database.schemas.map((schema) => ({
        label:
          databases.length > 1
            ? `${database.databaseName}.${schema.schemaName}`
            : schema.schemaName,
        tables: getSchemaBrowserTables(schema, datasource.type === "bigquery"),
      })),
    );
  }, [informationSchema, datasource.type]);
  const tablesById = useMemo(
    () => new Map(groups.flatMap((g) => g.tables.map((t) => [t.id, t]))),
    [groups],
  );

  let content: React.ReactNode;
  // Callouts need more room under the label than the select does
  let ready = false;
  if (managedWarehousePending) {
    content = <ManagedWarehouseNoEventsCallout size="sm" />;
  } else if (fetchError) {
    content = (
      <Callout status="error" size="sm">
        {fetchError.message}
      </Callout>
    );
  } else if (!data) {
    content = <LoadingSpinner />;
  } else if (building) {
    content = (
      <PendingInformationSchemaCard
        size="sm"
        mutate={mutate}
        timeoutMessage={
          <>
            This is taking a while. Check back in a minute or{" "}
            <Link onClick={onSwitchToSql}>Switch to SQL mode</Link>
          </>
        }
      />
    );
  } else if (!informationSchema) {
    content = (
      <BuildInformationSchemaCard
        size="sm"
        error={error}
        canRunQueries={canRunQueries}
        refreshOrCreateInfoSchema={buildSchema}
      />
    );
  } else if (informationSchema.error) {
    content = (
      <RetryInformationSchemaCard
        size="sm"
        error={error}
        canRunQueries={canRunQueries}
        informationSchema={informationSchema}
        refreshOrCreateInfoSchema={buildSchema}
      />
    );
  } else {
    ready = true;
    content = (
      <>
        <SelectField
          value={selectedTable?.id ?? ""}
          onChange={(id) => {
            const table = tablesById.get(id);
            if (table) onSelectTable(table);
          }}
          options={groups.map((g) => ({
            label: g.label,
            options: g.tables.map((t) => ({
              value: t.id,
              label: t.shards
                ? `${t.tableName} (${t.shards} tables)`
                : t.tableName,
            })),
          }))}
          formatOptionLabel={({ value, label }) => (
            <Flex justify="between" align="center" gap="3">
              <span>{label}</span>
              <Text size="sm" color="text-low">
                {tablesById.get(value)?.numOfColumns} cols
              </Text>
            </Flex>
          )}
          placeholder="Search tables..."
          autoFocus={!selectedTable}
        />
        {error ? (
          <Callout status="error" size="sm" mt="2">
            {error}
          </Callout>
        ) : null}
      </>
    );
  }

  return (
    <Box>
      <Flex align="center" justify="between" mb={ready ? "1" : "2"}>
        <Text weight="semibold">Table</Text>
        {informationSchema && !building ? (
          <Flex align="center" gap="2">
            <Text size="sm" color="text-low">
              Updated {ago(informationSchema.dateUpdated)}
            </Text>
            <Tooltip
              style={{ display: "flex" }}
              body={
                canRunQueries
                  ? "Refresh tables"
                  : "You don't have permission to load tables for this Data Source."
              }
            >
              <IconButton
                type="button"
                variant="ghost"
                size="1"
                aria-label="Refresh tables"
                disabled={!canRunQueries}
                onClick={() => buildSchema("PUT")}
              >
                <PiArrowClockwise />
              </IconButton>
            </Tooltip>
          </Flex>
        ) : null}
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
  columns?: DetectedFactTableColumn[];
};

export default function NewFactTableSqlStep({
  datasourceId,
  setDatasourceId,
  sql,
  setSql,
  detected,
  hasFreshResults,
  onColumnsDetected,
  validateRef,
  mode,
  setMode,
  selectedTable,
  onSelectTable,
  tableColumnsError,
  columnError,
}: {
  datasourceId: string;
  setDatasourceId: (id: string) => void;
  sql: string;
  setSql: (sql: string) => void;
  detected: DetectedFactTableColumn[] | null;
  hasFreshResults: boolean;
  onColumnsDetected: (columns: DetectedFactTableColumn[], sql: string) => void;
  validateRef: MutableRefObject<(() => Promise<void>) | null>;
  mode: FactTableSqlMode;
  setMode: (mode: FactTableSqlMode) => void;
  selectedTable: SchemaBrowserTable | null;
  onSelectTable: (table: SchemaBrowserTable) => void;
  tableColumnsError: string | null;
  columnError: string | null;
}) {
  const { apiCall } = useAuth();
  const { getDatasourceById, datasources, project } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const [testQueryResults, setTestQueryResults] =
    useState<TestQueryResults | null>(null);
  const [testingQuery, setTestingQuery] = useState(false);
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

  const validDatasources = datasources
    .filter((d) => isProjectListValidForProject(d.projects, project))
    .filter((d) => d.properties?.queryLanguage === "sql");

  // Bumped per picked table so a slow query can't apply results to the next one
  const tableGeneration = useRef(0);

  const runQuery = useCallback(
    async (limit: number): Promise<TestQueryResults> => {
      const generation = tableGeneration.current;
      const isStale = () => generation !== tableGeneration.current;
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
          }),
        });
        const results = { ...res, error: res.error || "" };
        if (isStale()) return results;
        // A `LIMIT 0` validation run has no rows to show, and the pane's
        // contents belong to the SQL the user just edited away from.
        setTestQueryResults(limit || results.error ? results : null);
        if (!results.error) {
          onColumnsDetected(results.columns || [], sql);
        }
        return results;
      } catch (e) {
        const results = { sql, error: e.message };
        if (!isStale()) setTestQueryResults(results);
        return results;
      } finally {
        setTestingQuery(false);
      }
    },
    [apiCall, datasourceId, sql, onColumnsDetected],
  );

  useEffect(() => {
    validateRef.current = async () => {
      if (hasFreshResults) {
        if (columnError) throw new Error(columnError);
        return;
      }
      const results = await runQuery(0);
      if (results.error || !results.columns?.length) throw new Error("");
      const error = getColumnMappingError(results.columns, mode === "table");
      if (error) throw new Error(error);
    };
    return () => {
      validateRef.current = null;
    };
  }, [validateRef, hasFreshResults, columnError, runQuery, mode]);

  useEffect(() => {
    tableGeneration.current++;
    setTestQueryResults(null);
  }, [selectedTable?.id]);

  const testButton = (label: string) => (
    <Tooltip
      body={
        canRunQueries
          ? `Runs a LIMIT ${SAMPLE_ROW_LIMIT} query, which may trigger a full table scan`
          : "You do not have permission to run test queries"
      }
    >
      <Button
        size="sm"
        variant="soft"
        icon={<PiPlay />}
        onClick={() => runQuery(SAMPLE_ROW_LIMIT)}
        loading={testingQuery}
        disabled={!canRunQueries || !sql}
      >
        {label}
      </Button>
    </Tooltip>
  );

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
            {testButton("Test Query")}
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
          placeholder={"SELECT\n  user_id,\n  timestamp\nFROM\n  events"}
          fullHeight
          setCursorData={setCursorData}
          onCtrlEnter={() => runQuery(SAMPLE_ROW_LIMIT)}
          onEditorLoad={(editor) => editor.focus()}
          completions={autoCompletions}
        />
      </Box>
    </AreaWithHeader>
  );

  const datasourceSelect = (label?: string) => (
    <Select
      label={label}
      aria-label="Data Source"
      value={datasourceId}
      setValue={setDatasourceId}
      placeholder="Select..."
      mb="0"
    >
      {validDatasources.map((d) => (
        <SelectItem key={d.id} value={d.id}>
          {d.name}
        </SelectItem>
      ))}
    </Select>
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
              icon={<PiArrowRight />}
              iconPosition="right"
              onClick={() => setMode("sql")}
            >
              Switch to SQL mode
            </Button>
          }
        >
          You are in the simple table mode.
        </Callout>
        {datasourceSelect("Data Source")}
        <TablePicker
          key={datasource.id}
          datasource={datasource}
          selectedTable={selectedTable}
          onSelectTable={onSelectTable}
          onSwitchToSql={() => setMode("sql")}
        />
        {tableColumnsError ? (
          <Callout status="error" size="sm">
            {tableColumnsError}
          </Callout>
        ) : null}
        {/* Holds the button's space so picking a table doesn't resize the modal */}
        {!columnError ? (
          <Box style={{ visibility: selectedTable ? "visible" : "hidden" }}>
            {testButton("Preview rows")}
          </Box>
        ) : null}
        {resultsTable ? (
          <Flex direction="column" style={{ maxHeight: 300 }}>
            {resultsTable}
          </Flex>
        ) : null}
        {callouts}
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2" height="100%">
      <Flex align="center" gap="5">
        <Box width="320px">{datasourceSelect()}</Box>
        {supportsSchemaBrowser ? (
          <Link onClick={() => setMode("table")}>
            <Flex align="center" gap="1">
              <PiArrowLeft /> Back to simple table mode
            </Flex>
          </Link>
        ) : null}
      </Flex>
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
                  openFirstSchema
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
