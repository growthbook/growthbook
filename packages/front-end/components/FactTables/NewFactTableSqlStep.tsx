import { MutableRefObject, useCallback, useEffect, useState } from "react";
import { PiDotsThreeVertical, PiPlay, PiWarningFill } from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { TestQueryRow } from "shared/types/integrations";
import { DetectedFactTableColumn } from "shared/types/fact-table";
import { isProjectListValidForProject, parseIntWithDefault } from "shared/util";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import { getColumnMappingError } from "@/services/factTables";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
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
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

const SAMPLE_ROW_LIMIT = 20;

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
  columns?: DetectedFactTableColumn[];
  sourceSql?: string;
};

export default function NewFactTableSqlStep({
  datasourceId,
  setDatasourceId,
  sql,
  setSql,
  detected,
  detectedSql,
  onColumnsDetected,
  validateRef,
}: {
  datasourceId: string;
  setDatasourceId: (id: string) => void;
  sql: string;
  setSql: (sql: string) => void;
  detected: DetectedFactTableColumn[] | null;
  detectedSql: string | null;
  onColumnsDetected: (columns: DetectedFactTableColumn[]) => void;
  validateRef: MutableRefObject<(() => Promise<void>) | null>;
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

  const runQuery = useCallback(
    async (
      limit: number,
      sqlOverride: string = sql,
    ): Promise<TestQueryResults> => {
      setTestingQuery(true);
      try {
        validateSQL(sqlOverride, []);
        const res = await apiCall<TestQueryResults>("/query/test", {
          method: "POST",
          body: JSON.stringify({
            query: sqlOverride,
            datasourceId,
            limit,
            detectColumns: true,
          }),
        });
        const results = {
          ...res,
          error: res.error || "",
          sourceSql: sqlOverride,
        };
        // A `LIMIT 0` validation run has no rows to show, and the pane's
        // contents belong to the SQL the user just edited away from.
        setTestQueryResults(limit || results.error ? results : null);
        if (!results.error) {
          onColumnsDetected(results.columns || []);
        }
        return results;
      } catch (e) {
        const results = {
          sql: sqlOverride,
          sourceSql: sqlOverride,
          error: e instanceof Error ? e.message : String(e),
        };
        setTestQueryResults(results);
        return results;
      } finally {
        setTestingQuery(false);
      }
    },
    [apiCall, datasourceId, sql, onColumnsDetected],
  );

  const hasFreshResults = detectedSql === sql && !!detected?.length;
  const columnError = hasFreshResults
    ? getColumnMappingError(detected || [])
    : null;

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

  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={70}>
        <Flex direction="column" gap="2" height="100%">
          <Box flexGrow="1" style={{ minHeight: 0 }}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={testQueryResults ? 60 : 100} minSize={20}>
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
                            size="sm"
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
                            <IconButton
                              variant="ghost"
                              color="gray"
                              radius="full"
                              size="3"
                            >
                              <PiDotsThreeVertical size={16} />
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
                  <Box height="100%">
                    <CodeTextArea
                      wrapperClassName={styles["sql-editor-wrapper"]}
                      language="sql"
                      value={sql}
                      setValue={(v) => {
                        if (formatError) setFormatError(null);
                        setSql(v);
                      }}
                      placeholder={
                        "SELECT\n  user_id,\n  timestamp\nFROM\n  events"
                      }
                      fullHeight
                      setCursorData={setCursorData}
                      onCtrlEnter={() => runQuery(SAMPLE_ROW_LIMIT)}
                      onEditorLoad={(editor) => editor.focus()}
                      completions={autoCompletions}
                    />
                  </Box>
                </AreaWithHeader>
              </Panel>
              {testQueryResults ? (
                <>
                  <PanelResizeHandle />
                  <Panel defaultSize={40} minSize={15}>
                    <DisplayTestQueryResults
                      duration={parseIntWithDefault(
                        testQueryResults.duration,
                        0,
                      )}
                      results={testQueryResults.results || []}
                      sql={testQueryResults.sql || ""}
                      error={testQueryResults.error || ""}
                      close={() => setTestQueryResults(null)}
                      sqlDebug={
                        testQueryResults.sourceSql === sql
                          ? {
                              datasourceId,
                              queryKind: "fact-table",
                              sourceSql: testQueryResults.sourceSql,
                              context: {
                                userIdTypes:
                                  datasource?.settings?.userIdTypes?.map(
                                    ({ userIdType }) => userIdType,
                                  ),
                                timestampColumn: "timestamp",
                              },
                              onApplySql: (suggestedSql) => {
                                setSql(suggestedSql);
                                setTestQueryResults(null);
                              },
                              onApplyAndRun: async (suggestedSql) => {
                                setSql(suggestedSql);
                                await runQuery(SAMPLE_ROW_LIMIT, suggestedSql);
                              },
                            }
                          : undefined
                      }
                    />
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
                sql={sql}
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
