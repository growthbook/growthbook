import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FaPlay, FaExclamationTriangle } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, Text, IconButton } from "@radix-ui/themes";
import { isReadOnlySQL, SQL_ROW_LIMIT } from "shared/sql";
import {
  InformationSchemaInterfaceWithPaths,
  QueryResponseColumnData,
} from "shared/types/integrations";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import CodeTextArea, { AceCompletion } from "@/components/Forms/CodeTextArea";
import { CursorData } from "@/components/Segments/SegmentForm";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import { formatSql, canFormatSql } from "@/services/sqlFormatter";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import { getAutoCompletions } from "@/services/sqlAutoComplete";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import { AreaWithHeader } from "@/components/SchemaBrowser/SqlExplorerModal";
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";

export interface ProductAnalyticsSqlModalProps {
  close: () => void;
  datasourceId: string;
  initialSql?: string;
  onSave: (data: {
    sql: string;
    columnTypes: Record<
      string,
      "string" | "number" | "date" | "boolean" | "other"
    >;
  }) => void;
}

interface QueryResult {
  results: Record<string, unknown>[];
  error?: string | null;
  duration?: number;
  sql?: string;
  columns?: QueryResponseColumnData[];
}

interface FormData {
  sql: string;
  results: QueryResult;
}

export default function ProductAnalyticsSqlModal({
  close,
  datasourceId,
  initialSql = "",
  onSave,
}: ProductAnalyticsSqlModalProps) {
  const [loading, setLoading] = useState(false);
  const [isRunningQuery, setIsRunningQuery] = useState(false);
  const [isAutocompleteEnabled, setIsAutocompleteEnabled] = useLocalStorage(
    "sql-editor-autocomplete-enabled",
    true,
  );
  const [autoCompletions, setAutoCompletions] = useState<AceCompletion[]>([]);
  const [informationSchema, setInformationSchema] = useState<
    InformationSchemaInterfaceWithPaths | undefined
  >();
  const [detectedColumns, setDetectedColumns] = useState<
    Record<string, "string" | "number" | "date" | "boolean" | "other">
  >({});
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [formatError, setFormatError] = useState<string | null>(null);

  const { getDatasourceById } = useDefinitions();
  const { apiCall } = useAuth();

  const datasource = getDatasourceById(datasourceId);

  const form = useForm<FormData>({
    defaultValues: {
      sql: initialSql,
      results: {
        results: [],
        error: undefined,
        duration: undefined,
        sql: undefined,
      },
    },
  });

  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;
  const canFormat = datasource ? canFormatSql(datasource.type) : false;

  const runQuery = useCallback(
    async (sql: string) => {
      if (!isReadOnlySQL(sql)) {
        throw new Error("Only SELECT queries are allowed.");
      }

      const res = await apiCall<QueryResult>("/query/run", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId,
          limit: SQL_ROW_LIMIT,
        }),
      });
      return res;
    },
    [apiCall, datasourceId],
  );

  const detectColumns = useCallback(async (sql: string) => {
    // Run LIMIT 0 query to get column metadata
    // Get the results & call setDetectedColumns with the column types
    // TODO: Let's mock this for now
    setDetectedColumns({
      user_id: "string",
      event_name: "string",
      event_date: "date",
      event_time: "string",
      paid_customer: "boolean",
      timestamp: "date",
      revenue: "number",
    });
  }, []);

  const handleQuery = useCallback(async () => {
    setIsRunningQuery(true);
    // Reset the results field so it's empty
    form.setValue("results", {
      results: [],
      error: undefined,
      duration: undefined,
      sql: undefined,
    });

    try {
      // First, run the query for preview
      const { results, error, duration, sql } = await runQuery(
        form.watch("sql"),
      );

      // Update the form's results field
      form.setValue("results", {
        results: results || [],
        error,
        duration,
        sql,
      });

      // If query succeeded, detect columns
      if (!error) {
        await detectColumns(form.watch("sql"));
      }
    } catch (e) {
      form.setValue("results", {
        results: [],
        error: e.message,
        duration: undefined,
        sql: form.watch("sql"),
      });
    }
    setIsRunningQuery(false);
  }, [form, runQuery, detectColumns]);

  const handleFormatClick = () => {
    const result = formatSql(form.watch("sql"), datasource?.type);
    if (result.error) {
      setFormatError(result.error);
    } else if (result.formattedSql) {
      form.setValue("sql", result.formattedSql);
      setFormatError(null);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);

    try {
      const sql = form.watch("sql").trim();

      if (!sql) {
        throw new Error("SQL query cannot be empty");
      }

      if (!isReadOnlySQL(sql)) {
        throw new Error("Only SELECT queries are allowed");
      }

      if (Object.keys(detectedColumns).length === 0) {
        throw new Error(
          "Please run the query first to detect columns before saving",
        );
      }

      await onSave({
        sql,
        columnTypes: detectedColumns,
      });

      close();
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  // Update autocompletions when cursor or schema changes
  useEffect(() => {
    const fetchCompletions = async () => {
      if (!isAutocompleteEnabled) {
        setAutoCompletions([]);
        return;
      }
      try {
        const completions = await getAutoCompletions(
          cursorData,
          informationSchema,
          datasource?.type,
          apiCall,
          "SqlExplorer",
        );
        setAutoCompletions(completions);
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

  return (
    <Modal
      bodyClassName="p-0"
      borderlessHeader={true}
      close={close}
      loading={loading}
      closeCta="Cancel"
      cta="Apply Changes"
      ctaEnabled={
        !!form.watch("sql").trim() && Object.keys(detectedColumns).length > 0
      }
      disabledMessage={
        !form.watch("sql").trim()
          ? "Enter a SQL query"
          : Object.keys(detectedColumns).length === 0
            ? "Run the query to detect columns before saving"
            : undefined
      }
      header="Product Analytics SQL Query"
      headerClassName={styles["modal-header-backgroundless"]}
      open={true}
      showHeaderCloseButton={true}
      size="max"
      autoCloseOnSubmit={false}
      submit={async () => await handleSubmit()}
      trackingEventModalType="product-analytics-sql"
      trackingEventModalSource="product-analytics-explorer"
      useRadixButton={true}
    >
      <Box
        px="4"
        pb="2"
        style={{
          height: "calc(95vh - 127px)",
        }}
      >
        <PanelGroup direction="horizontal">
          <Panel id="main" order={1} defaultSize={70}>
            <PanelGroup direction="vertical">
              <Panel
                id="sql-editor"
                order={1}
                defaultSize={form.watch("results").sql ? 30 : 100}
                minSize={7}
              >
                <AreaWithHeader
                  header={
                    <Flex align="center" justify="between">
                      <Flex gap="4" align="center">
                        <Box>
                          <Text
                            weight="bold"
                            style={{ color: "var(--color-text-mid)" }}
                          >
                            SQL
                          </Text>
                        </Box>
                      </Flex>
                      <Flex gap="3" align="center">
                        <Tooltip body="The SQL Explorer automatically applies a 1000 row limit to ensure optimal performance.">
                          <Box pl="5">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              id={`limit-toggle`}
                              checked={true}
                              disabled={true}
                            />
                            <Text
                              size="1"
                              weight="medium"
                              style={{ color: "var(--gray-8)" }}
                              className="cursor-pointer"
                            >
                              Limit to {SQL_ROW_LIMIT} rows
                            </Text>
                          </Box>
                        </Tooltip>
                        {formatError && (
                          <Tooltip body={formatError}>
                            <span>
                              <FaExclamationTriangle className="text-danger" />
                            </span>
                          </Tooltip>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={handleFormatClick}
                          disabled={!form.watch("sql") || !canFormat}
                        >
                          Format
                        </Button>
                        <Tooltip
                          body="Enter a SQL query to run"
                          shouldDisplay={!form.watch("sql")}
                        >
                          <Button
                            size="xs"
                            onClick={handleQuery}
                            disabled={!form.watch("sql")}
                            loading={isRunningQuery}
                            icon={<FaPlay />}
                          >
                            Run
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
                            onClick={() => {
                              setIsAutocompleteEnabled(!isAutocompleteEnabled);
                            }}
                          >
                            {isAutocompleteEnabled
                              ? "Disable Autocomplete"
                              : "Enable Autocomplete"}
                          </DropdownMenuItem>
                        </DropdownMenu>
                      </Flex>
                    </Flex>
                  }
                >
                  <CodeTextArea
                    wrapperClassName={styles["sql-editor-wrapper"]}
                    required
                    language="sql"
                    value={form.watch("sql")}
                    setValue={(v) => {
                      if (formatError) {
                        setFormatError(null);
                      }
                      form.setValue("sql", v);
                    }}
                    helpText={""}
                    fullHeight
                    setCursorData={setCursorData}
                    onCtrlEnter={handleQuery}
                    completions={autoCompletions}
                  />
                </AreaWithHeader>
              </Panel>
              {form.watch("results").sql && (
                <>
                  <PanelResizeHandle />
                  <Panel
                    id="query-results"
                    order={2}
                    defaultSize={form.watch("results").results ? 70 : 0}
                    minSize={10}
                  >
                    <DisplayTestQueryResults
                      duration={form.watch("results").duration || 0}
                      results={form.watch("results").results || []}
                      sql={form.watch("results").sql || ""}
                      error={form.watch("results").error || ""}
                      allowDownload={true}
                      showSampleHeader={false}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          <>
            <PanelResizeHandle />
            <Panel
              id="sidebar"
              order={2}
              defaultSize={30}
              minSize={20}
              maxSize={80}
            >
              <AreaWithHeader
                header={
                  <Flex align="center" gap="1">
                    <Text
                      weight="bold"
                      style={{ color: "var(--color-text-mid)" }}
                    >
                      Schema Browser
                    </Text>
                  </Flex>
                }
              >
                <Flex direction="column" height="100%" px="4" py="5">
                  {supportsSchemaBrowser && datasource && (
                    <SchemaBrowser
                      updateSqlInput={(sql: string) => {
                        form.setValue("sql", sql);
                      }}
                      datasource={datasource}
                      cursorData={cursorData || undefined}
                    />
                  )}
                </Flex>
              </AreaWithHeader>
            </Panel>
          </>
        </PanelGroup>
      </Box>
    </Modal>
  );
}
