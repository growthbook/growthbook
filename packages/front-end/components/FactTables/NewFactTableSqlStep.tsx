import { MutableRefObject, useCallback, useEffect, useState } from "react";
import { FaExclamationTriangle, FaPlay } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  InformationSchemaInterfaceWithPaths,
  TestQueryRow,
} from "shared/types/integrations";
import { DetectedFactTableColumn } from "shared/types/fact-table";
import { isProjectListValidForProject, parseIntWithDefault } from "shared/util";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import CodeTextArea, { AceCompletion } from "@/components/Forms/CodeTextArea";
import Field from "@/components/Forms/Field";
import { CursorData } from "@/components/Segments/SegmentForm";
import LoadingSpinner from "@/components/LoadingSpinner";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import { usesEventName } from "@/components/Metrics/MetricForm";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import { AreaWithHeader } from "@/components/SchemaBrowser/SqlExplorerModal";
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";
import { getAutoCompletions } from "@/services/sqlAutoComplete";
import { canFormatSql, formatSql } from "@/services/sqlFormatter";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

// Rows to read when the user asks to preview data. Always an explicit opt-in,
// since the query can't be filtered by date until the timestamp column is set.
const SAMPLE_ROW_LIMIT = 20;

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
  // Columns the query outputs, detected server-side. Falls back to the
  // warehouse's reported schema when the query returns no rows.
  columns?: DetectedFactTableColumn[];
};

export default function NewFactTableSqlStep({
  datasourceId,
  setDatasourceId,
  sql,
  setSql,
  eventName,
  setEventName,
  detected,
  detectedSql,
  onColumnsDetected,
  validateRef,
}: {
  datasourceId: string;
  setDatasourceId: (id: string) => void;
  sql: string;
  setSql: (sql: string) => void;
  eventName: string;
  setEventName: (eventName: string) => void;
  detected: DetectedFactTableColumn[] | null;
  // The SQL that produced `detected`, so we know when the columns are stale
  detectedSql: string | null;
  onColumnsDetected: (columns: DetectedFactTableColumn[]) => void;
  // Filled in with what the modal's Next button should do: run the query if the
  // SQL hasn't been tested yet, and refuse to advance if it comes back unusable.
  validateRef: MutableRefObject<(() => Promise<void>) | null>;
}) {
  const { apiCall } = useAuth();
  const { getDatasourceById, datasources, project } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const [testQueryResults, setTestQueryResults] =
    useState<TestQueryResults | null>(null);
  // Rows from an explicit sample query, which running the SQL never returns
  const [sample, setSample] = useState<TestQueryResults | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [testingQuery, setTestingQuery] = useState(false);
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [autoCompletions, setAutoCompletions] = useState<AceCompletion[]>([]);
  const [informationSchema, setInformationSchema] = useState<
    InformationSchemaInterfaceWithPaths | undefined
  >();
  const [isAutocompleteEnabled, setIsAutocompleteEnabled] = useLocalStorage(
    "sql-editor-autocomplete-enabled",
    true,
  );

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

  // limit 0 reads the query's output schema without reading any rows, which is
  // what keeps this off the table: with no timestamp column yet the query
  // can't be date-filtered, and LIMIT doesn't bound how much a warehouse scans.
  const runQuery = useCallback(async (): Promise<TestQueryResults> => {
    setTestingQuery(true);
    try {
      validateSQL(sql, []);
      const res = await apiCall<TestQueryResults>("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId,
          templateVariables: { eventName },
          limit: 0,
          detectColumns: true,
        }),
      });
      const results = { ...res, error: res.error || "" };
      setTestQueryResults(results);
      // Any preview belongs to the SQL that produced it. Close the panel too --
      // re-fetching rows is a scan, so it waits for another explicit click.
      setSample(null);
      setSampleOpen(false);
      // Reported even when empty, so a run that stops returning columns
      // clears the stale ones rather than leaving them on screen
      if (!results.error) {
        onColumnsDetected(results.columns || []);
      }
      return results;
    } catch (e) {
      const results = { sql, error: e.message };
      setTestQueryResults(results);
      setSample(null);
      setSampleOpen(false);
      return results;
    } finally {
      setTestingQuery(false);
    }
  }, [apiCall, datasourceId, eventName, sql, onColumnsDetected]);

  // Reading rows also lets detection narrow the types the schema couldn't
  // pin down -- JSON held in a string column, or a warehouse that reports
  // column names without types at all.
  const runSampleQuery = useCallback(async () => {
    setSampleLoading(true);
    try {
      const res = await apiCall<TestQueryResults>("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId,
          templateVariables: { eventName },
          limit: SAMPLE_ROW_LIMIT,
          detectColumns: true,
        }),
      });
      setSample({ ...res, error: res.error || "" });
      if (!res.error && res.columns?.length) {
        onColumnsDetected(res.columns);
      }
    } catch (e) {
      setSample({ sql, error: e.message });
    } finally {
      setSampleLoading(false);
    }
  }, [apiCall, datasourceId, eventName, sql, onColumnsDetected]);

  // Opening the panel runs the query -- the scan warning lives on the button's
  // tooltip, so the click is the confirmation. Rows already fetched for this
  // SQL are reused; running the SQL again clears them.
  const toggleSample = useCallback(() => {
    if (sampleOpen) {
      setSampleOpen(false);
      return;
    }
    setSampleOpen(true);
    if (!sample && !sampleLoading) runSampleQuery();
  }, [sampleOpen, sample, sampleLoading, runSampleQuery]);

  // Update autocompletions when the cursor or schema changes
  useEffect(() => {
    const fetchCompletions = async () => {
      if (!isAutocompleteEnabled) {
        setAutoCompletions([]);
        return;
      }
      try {
        setAutoCompletions(
          await getAutoCompletions(
            cursorData,
            informationSchema,
            datasource?.type,
            apiCall,
            // Selects the completion set that includes template variables
            "EditSqlModal",
            eventName,
          ),
        );
      } catch (error) {
        console.error("Failed to fetch autocompletions:", error);
        setAutoCompletions([]);
      }
    };

    const timeoutId = setTimeout(fetchCompletions, 200);
    return () => clearTimeout(timeoutId);
  }, [
    cursorData,
    informationSchema,
    datasource?.type,
    apiCall,
    eventName,
    isAutocompleteEnabled,
  ]);

  useEffect(() => {
    const fetchSchema = async () => {
      if (!isAutocompleteEnabled) {
        setInformationSchema(undefined);
        return;
      }
      try {
        const response = await apiCall<{
          informationSchema: InformationSchemaInterfaceWithPaths;
        }>(`/datasource/${datasourceId}/schema`);
        setInformationSchema(response.informationSchema);
      } catch (error) {
        console.error("Failed to fetch schema:", error);
        setInformationSchema(undefined);
      }
    };

    fetchSchema();
  }, [datasourceId, apiCall, isAutocompleteEnabled]);

  // Survives stepping back from the configure step, which unmounts this
  // component -- there's no need to re-run a query the SQL hasn't outgrown.
  const hasFreshResults = detectedSql === sql && !!detected?.length;

  useEffect(() => {
    validateRef.current = async () => {
      if (hasFreshResults) return;
      const results = await runQuery();
      // Both failures are already spelled out in this step, so don't repeat
      // them in the modal's error bar
      if (results.error || !results.columns?.length) throw new Error("");
    };
    // Once the modal is past this step the query has already been tested, and
    // this closure's view of that is stale
    return () => {
      validateRef.current = null;
    };
  }, [validateRef, hasFreshResults, runQuery]);

  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={70}>
        <Flex direction="column" gap="2" height="100%">
          <Box flexGrow="1" style={{ minHeight: 0 }}>
            <PanelGroup direction="vertical">
              <Panel
                defaultSize={testQueryResults?.error || sampleOpen ? 60 : 100}
                minSize={20}
              >
                <AreaWithHeader
                  header={
                    <Flex align="center" justify="between">
                      <Text weight="semibold" color="text-mid">
                        SQL
                      </Text>
                      <Flex gap="3" align="center">
                        {formatError && (
                          <Tooltip body={formatError}>
                            <FaExclamationTriangle className="text-danger" />
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
                          body="You do not have permission to run test queries"
                          shouldDisplay={!canRunQueries}
                        >
                          <Button
                            size="sm"
                            variant="soft"
                            icon={<FaPlay />}
                            onClick={runQuery}
                            loading={testingQuery}
                            disabled={!canRunQueries || !sql}
                          >
                            Test Query
                          </Button>
                        </Tooltip>
                        <DropdownMenu
                          trigger={
                            <IconButton
                              variant="ghost"
                              color="gray"
                              radius="full"
                              size="3"
                            >
                              <BsThreeDotsVertical size={16} />
                            </IconButton>
                          }
                        >
                          <DropdownMenuItem
                            onClick={() =>
                              setIsAutocompleteEnabled(!isAutocompleteEnabled)
                            }
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
                  <Box style={{ position: "relative", height: "100%" }}>
                    {usesEventName(sql) && (
                      <Box
                        p="2"
                        style={{
                          borderBottom: "1px solid var(--gray-a3)",
                          backgroundColor: "var(--slate-a2)",
                        }}
                      >
                        <Flex align="center" gap="4">
                          <Text size="sm" weight="semibold">
                            SQL template variables:
                          </Text>
                          <Field
                            size="sm"
                            label="eventName"
                            labelClassName="mr-2"
                            value={eventName}
                            onChange={(e) => setEventName(e.target.value)}
                          />
                        </Flex>
                      </Box>
                    )}
                    <CodeTextArea
                      wrapperClassName={styles["sql-editor-wrapper"]}
                      required
                      language="sql"
                      value={sql}
                      setValue={(v) => {
                        if (formatError) setFormatError(null);
                        setSql(v);
                      }}
                      placeholder={
                        "SELECT\n  user_id,\n  timestamp\nFROM\n  events"
                      }
                      helpText={""}
                      fullHeight
                      setCursorData={setCursorData}
                      onCtrlEnter={runQuery}
                      onEditorLoad={(editor) => editor.focus()}
                      completions={autoCompletions}
                    />
                  </Box>
                </AreaWithHeader>
              </Panel>
              {testQueryResults?.error ? (
                <>
                  <PanelResizeHandle />
                  <Panel minSize={20}>
                    <DisplayTestQueryResults
                      duration={0}
                      results={[]}
                      sql={testQueryResults.sql || ""}
                      error={testQueryResults.error}
                      close={() => setTestQueryResults(null)}
                    />
                  </Panel>
                </>
              ) : sampleOpen && (sample || sampleLoading) ? (
                <>
                  <PanelResizeHandle />
                  <Panel defaultSize={40} minSize={15}>
                    {sample ? (
                      <DisplayTestQueryResults
                        duration={parseIntWithDefault(sample.duration, 0)}
                        results={sample.results || []}
                        sql={sample.sql || ""}
                        error={sample.error || ""}
                        close={() => setSampleOpen(false)}
                      />
                    ) : (
                      <AreaWithHeader
                        header={
                          <Text weight="semibold" color="text-mid">
                            Sample rows
                          </Text>
                        }
                      >
                        <Flex align="center" gap="2" p="3">
                          <LoadingSpinner />
                          <Text color="text-mid">
                            Running LIMIT {SAMPLE_ROW_LIMIT} query...
                          </Text>
                        </Flex>
                      </AreaWithHeader>
                    )}
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </Box>

          {testQueryResults && !testQueryResults.error && !detected?.length && (
            <Callout status="warning">
              Your warehouse reported no output columns for this query.
              Double-check the SQL, then run it again.
            </Callout>
          )}

          <Flex align="center" justify="between" gap="3">
            {detected?.length ? (
              <Callout status="success" size="sm">
                Query ran successfully
              </Callout>
            ) : (
              <div />
            )}
            <Tooltip
              body={
                canRunQueries
                  ? `Runs a LIMIT ${SAMPLE_ROW_LIMIT} query, which may trigger a full table scan`
                  : "You do not have permission to run test queries"
              }
            >
              <Button
                variant="ghost"
                size="sm"
                icon={sampleOpen ? <PiCaretDown /> : <PiCaretRight />}
                onClick={toggleSample}
                disabled={!canRunQueries || !sql}
              >
                View sample rows
              </Button>
            </Tooltip>
          </Flex>
        </Flex>
      </Panel>
      <PanelResizeHandle />
      <Panel defaultSize={30} minSize={20} maxSize={50}>
        <AreaWithHeader
          header={
            <Select
              label="Data Source"
              labelSize="sm"
              value={datasourceId}
              setValue={setDatasourceId}
              placeholder="Select..."
            >
              {validDatasources.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </Select>
          }
        >
          {datasource && supportsSchemaBrowser ? (
            <Flex direction="column" height="100%" p="4">
              <SchemaBrowser
                updateSqlInput={setSql}
                datasource={datasource}
                cursorData={cursorData || undefined}
              />
            </Flex>
          ) : (
            <Box p="4">
              <Text size="sm" color="text-mid">
                This Data Source does not support browsing schemas.
              </Text>
            </Box>
          )}
        </AreaWithHeader>
      </Panel>
    </PanelGroup>
  );
}
