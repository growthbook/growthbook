import {
  CSSProperties,
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  PiDotsThreeVertical,
  PiPencilSimple,
  PiPlay,
  PiTable,
  PiWarningFill,
} from "react-icons/pi";
import { Box, Flex, IconButton, SegmentedControl } from "@radix-ui/themes";
import { Column, TestQueryRow } from "shared/types/integrations";
import { DetectedFactTableColumn } from "shared/types/fact-table";
import { isProjectListValidForProject, parseIntWithDefault } from "shared/util";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import { getColumnMappingError } from "@/services/factTables";
import { SchemaBrowserTable } from "@/services/schemaBrowserTables";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import LoadingSpinner from "@/components/LoadingSpinner";
import { TestQueryResultsTable } from "@/components/Settings/DisplayTestQueryResults";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import AreaWithHeader from "@/components/SchemaBrowser/AreaWithHeader";
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
import Table, { TableBody, TableCell, TableRow } from "@/ui/Table";
import Text from "@/ui/Text";

const SAMPLE_ROW_LIMIT = 20;

export type FactTableSqlMode = "table" | "sql";

const panelBorder = {
  border: "1px solid var(--gray-a3)",
  borderRadius: "var(--radius-4)",
};

function TableColumns({
  columns,
  error,
}: {
  columns: Column[] | null;
  error: string | null;
}) {
  if (error) return <Callout status="error">{error}</Callout>;
  if (!columns) return <LoadingSpinner />;
  return (
    <Table size="sm" variant="surface">
      <TableBody>
        {columns.map((c, i) => (
          <TableRow key={`${c.columnName}:${i}`}>
            <TableCell>{c.columnName}</TableCell>
            <TableCell>
              <Text size="sm" color="text-mid">
                {c.dataType}
              </Text>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
  tableColumns,
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
  tableColumns: Column[] | null;
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
      const error = getColumnMappingError(results.columns);
      if (error) throw new Error(error);
    };
    return () => {
      validateRef.current = null;
    };
  }, [validateRef, hasFreshResults, columnError, runQuery]);

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

  const emptyState = (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="2"
      height="100%"
      p="4"
      style={panelBorder}
    >
      <PiTable size={28} color="var(--gray-9)" />
      <Text size="lg" weight="semibold">
        Choose a table
      </Text>
      <Text color="text-mid">
        Pick a table on the right{" "}
        <Link onClick={() => setMode("sql")}>or write SQL manually</Link>
      </Text>
    </Flex>
  );

  const tableSummary = selectedTable ? (
    <AreaWithHeader
      header={
        <Flex align="center" justify="between" gap="3">
          <Flex align="baseline" gap="2" style={{ minWidth: 0 }}>
            <Text weight="semibold">{selectedTable.tableName}</Text>
            <Text size="sm" color="text-mid">
              {selectedTable.schemaName}
            </Text>
          </Flex>
          <Flex align="center" gap="3">
            {testButton("Preview rows")}
            <Button
              size="sm"
              variant="outline"
              icon={<PiPencilSimple />}
              onClick={() => setMode("sql")}
            >
              Edit SQL
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Box p="3">
        <TableColumns columns={tableColumns} error={tableColumnsError} />
      </Box>
    </AreaWithHeader>
  ) : (
    emptyState
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

  return (
    <Flex direction="column" gap="2" height="100%">
      <Flex align="center" gap="5">
        <Box width="320px">
          <Select
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
        </Box>
        {supportsSchemaBrowser ? (
          <Flex align="center" gap="2">
            <Text weight="medium">Editing mode</Text>
            <SegmentedControl.Root
              value={mode}
              onValueChange={(v) => setMode(v as FactTableSqlMode)}
              aria-label="Editing mode"
              style={
                {
                  "--segmented-control-indicator-background-color":
                    "var(--accent-5)",
                } as CSSProperties
              }
            >
              <SegmentedControl.Item value="table">Table</SegmentedControl.Item>
              <SegmentedControl.Item value="sql">SQL</SegmentedControl.Item>
            </SegmentedControl.Root>
          </Flex>
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
                {mode === "table" ? tableSummary : sqlEditor}
              </Panel>
              {testQueryResults ? (
                <>
                  <PanelResizeHandle />
                  <Panel id="results" order={2} defaultSize={50} minSize={20}>
                    <Flex direction="column" height="100%">
                      <TestQueryResultsTable
                        compact
                        duration={parseIntWithDefault(
                          testQueryResults.duration,
                          0,
                        )}
                        results={testQueryResults.results || []}
                        sql={testQueryResults.sql || ""}
                        error={testQueryResults.error || ""}
                        onClose={() => setTestQueryResults(null)}
                      />
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
                {mode === "table" ? (
                  <SchemaBrowser
                    datasource={datasource}
                    openFirstSchema
                    selectedTableId={selectedTable?.id ?? null}
                    onTableClick={onSelectTable}
                  />
                ) : (
                  <SchemaBrowser
                    datasource={datasource}
                    openFirstSchema
                    updateSqlInput={setSql}
                    sql={sql}
                  />
                )}
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
      {columnError ? <Callout status="error">{columnError}</Callout> : null}
      {testQueryResults && !testQueryResults.error && !detected?.length && (
        <Callout status="warning">
          Your warehouse reported no output columns for this query. Double-check
          the SQL, then run it again.
        </Callout>
      )}
    </Flex>
  );
}
