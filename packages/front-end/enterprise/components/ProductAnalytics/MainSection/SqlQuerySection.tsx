import React, { useEffect, useRef, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaExclamationTriangle } from "react-icons/fa";
import { PiCaretDown, PiCaretRight, PiPlay, PiQuestion } from "react-icons/pi";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  ExplorationConfig,
  QueryExecutionResult,
  SqlValue,
  type SqlDataset,
} from "shared/validators";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import AiSqlGenerator from "@/components/SchemaBrowser/AiSqlGenerator";
import AreaWithHeader from "@/components/SchemaBrowser/AreaWithHeader";
import Tooltip from "@/components/Tooltip/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { canFormatSql, formatSql } from "@/services/sqlFormatter";
import {
  createEmptyValue,
  getInferredTimestampColumn,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";

const PREVIEW_ROW_LIMIT = 100;
const SQL_PLACEHOLDER = `SELECT timestamp, user_id, event_name FROM events`;

export default function SqlQuerySection({
  fullHeight = false,
  showHeader = true,
  onChartReadyChange,
}: {
  fullHeight?: boolean;
  showHeader?: boolean;
  onChartReadyChange?: (ready: boolean) => void;
}) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const dataset =
    draftExploreState.dataset.type === "sql" ? draftExploreState.dataset : null;
  const datasource = draftExploreState.datasource
    ? getDatasourceById(draftExploreState.datasource)
    : null;
  const {
    autoCompletions,
    isAutocompleteEnabled,
    localSql,
    setLocalSql,
    setCursorData,
    setIsAutocompleteEnabled,
    setSchemaCollapsed,
  } = useSqlEditorContext();

  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] =
    useState<QueryExecutionResult | null>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const lastPreviewedSqlRef = useRef<string | null>(null);
  const collapseAfterSuccessfulRunRef = useRef(false);

  useEffect(() => {
    if ((dataset?.sql ?? "") !== lastPreviewedSqlRef.current) {
      setPreviewResult(null);
    }
  }, [dataset?.sql]);

  useEffect(() => {
    setError(null);
    setPreviewResult(null);
  }, [localSql]);

  useEffect(() => {
    lastPreviewedSqlRef.current = null;
    setPreviewResult(null);
  }, [draftExploreState.datasource]);

  useEffect(() => {
    if (!previewResult || error || !collapseAfterSuccessfulRunRef.current) {
      return;
    }
    collapseAfterSuccessfulRunRef.current = false;
    setSchemaCollapsed(true);
    editorPanelRef.current?.resize(30);
  }, [error, previewResult, setSchemaCollapsed]);

  const chartReady =
    dataset !== null &&
    localSql.trim().length > 0 &&
    localSql === dataset.sql &&
    dataset.timestampColumn.length > 0 &&
    dataset.columnTypes[dataset.timestampColumn] === "date" &&
    Object.keys(dataset.columnTypes).length > 0;

  useEffect(() => {
    onChartReadyChange?.(chartReady);
  }, [chartReady, onChartReadyChange]);

  if (!dataset) return null;

  const applyColumnMetadata = (
    sql: string,
    columnTypes: SqlDataset["columnTypes"],
    timestampColumn: string,
  ) => {
    setDraftExploreState((prev) => {
      if (prev.dataset.type !== "sql") return prev;
      const valueColumns = new Set(Object.keys(columnTypes));
      return {
        ...prev,
        dimensions: prev.dimensions.filter(
          (d) => d.dimensionType !== "dynamic",
        ),
        dataset: {
          ...prev.dataset,
          sql,
          columnTypes,
          timestampColumn,
          values: prev.dataset.values.length
            ? prev.dataset.values.map((value) => ({
                ...value,
                valueColumn:
                  value.valueColumn && valueColumns.has(value.valueColumn)
                    ? value.valueColumn
                    : null,
              }))
            : [createEmptyValue("sql") as SqlValue],
        },
      } as ExplorationConfig;
    });
  };

  const previewQuery = async (sql: string): Promise<boolean> => {
    if (!sql.trim() || !draftExploreState.datasource) return false;
    setLoading(true);
    setError(null);
    collapseAfterSuccessfulRunRef.current = false;
    try {
      const response = await apiCall<QueryExecutionResult>("/query/run", {
        method: "POST",
        body: JSON.stringify({
          datasourceId: draftExploreState.datasource,
          query: sql,
          limit: PREVIEW_ROW_LIMIT,
        }),
      });
      setPreviewResult(response);

      if (response.error) {
        setError(response.error);
        return false;
      }

      const columnTypes = Object.fromEntries(
        (response.columns ?? []).map((column) => [
          column.name,
          column.dataType ?? "other",
        ]),
      ) as SqlDataset["columnTypes"];
      const dateColumns = (response.columns ?? [])
        .filter((column) => column.dataType === "date")
        .map((column) => column.name);
      const inferredTimestamp = getInferredTimestampColumn(columnTypes);
      const timestampColumn =
        inferredTimestamp && columnTypes[inferredTimestamp] === "date"
          ? inferredTimestamp
          : (dateColumns[0] ?? "");

      lastPreviewedSqlRef.current = sql;
      applyColumnMetadata(sql, columnTypes, timestampColumn);

      if (dateColumns.length === 0) {
        setError(
          "Your SQL query must return at least one date or timestamp column.",
        );
        return false;
      }

      collapseAfterSuccessfulRunRef.current = true;
      return true;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err.message);
      setPreviewResult({
        error: err.message,
        results: [],
        sql,
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleFormatClick = () => {
    const result = formatSql(localSql, datasource?.type);
    if (result.error) {
      setFormatError(result.error);
    } else if (result.formattedSql) {
      setLocalSql(result.formattedSql);
      setFormatError(null);
    }
  };

  const sqlChanged = localSql !== dataset.sql;
  const canRunPreview = !!localSql.trim() && !!draftExploreState.datasource;
  const canFormat = datasource ? canFormatSql(datasource.type) : false;
  const showContent = open || !showHeader;
  const queryHelp = (
    <Tooltip
      body={
        <Flex direction="column" gap="2">
          <Text>
            Write a read-only query that returns rows with at least one date or
            timestamp column.
          </Text>
          <Text>
            Use the Schema Browser on the side bar to explore what data is
            available in your Data Source, and optionally use our AI SQL
            Generator to help you write the query.{" "}
          </Text>
        </Flex>
      }
      usePortal
    >
      <Button size="xs" variant="ghost" icon={<PiQuestion />}>
        Need help?
      </Button>
    </Tooltip>
  );

  const content = (
    <AiSqlGenerator
      datasourceId={draftExploreState.datasource}
      onSqlGenerated={(sql) => {
        setLocalSql(sql);
        setError(null);
        setPreviewResult(null);
      }}
    >
      {({ prompt, trigger }) => (
        <Box
          style={{
            border: showHeader ? "1px solid var(--gray-a3)" : undefined,
            borderRadius: showHeader ? "var(--radius-4)" : undefined,
            backgroundColor: showHeader
              ? "var(--color-panel-translucent)"
              : undefined,
            overflow: "hidden",
            flex: fullHeight && showContent ? 1 : undefined,
            minHeight: fullHeight && showContent ? 0 : undefined,
            display: fullHeight && showContent ? "flex" : undefined,
            flexDirection: fullHeight && showContent ? "column" : undefined,
          }}
        >
          {showHeader ? (
            <Flex
              align="center"
              justify="between"
              p="3"
              style={{
                borderBottom: open ? "1px solid var(--gray-a3)" : undefined,
              }}
            >
              <Button variant="ghost" onClick={() => setOpen(!open)}>
                <Flex align="center" gap="2">
                  {open ? <PiCaretDown /> : <PiCaretRight />}
                  <Text weight="medium">Query</Text>
                </Flex>
              </Button>
              <Flex align="center" justify="between" gap="3" mr="1">
                {sqlChanged ? (
                  <Text size="small" color="text-low">
                    Unsaved query changes
                  </Text>
                ) : null}
                {queryHelp}
              </Flex>
            </Flex>
          ) : null}
          {showContent && (
            <Flex
              direction="column"
              gap="3"
              p={showHeader ? "3" : "0"}
              style={{
                flex: fullHeight ? 1 : undefined,
                minHeight: fullHeight ? 0 : undefined,
              }}
            >
              <PanelGroup
                direction="horizontal"
                style={{
                  minHeight: fullHeight ? 0 : 360,
                  flex: fullHeight ? 1 : undefined,
                }}
              >
                <Panel order={1} defaultSize={100} minSize={45}>
                  <PanelGroup direction="vertical">
                    <Panel
                      ref={editorPanelRef}
                      order={1}
                      defaultSize={previewResult ? 60 : 100}
                      minSize={30}
                    >
                      <AreaWithHeader
                        header={
                          <Flex align="center" justify="between" gap="3">
                            <Flex align="center" gap="2">
                              <Text weight="medium">SQL</Text>
                              {trigger}
                            </Flex>
                            <Flex align="center" gap="2">
                              {formatError ? (
                                <Tooltip body={formatError}>
                                  <FaExclamationTriangle className="text-danger" />
                                </Tooltip>
                              ) : null}
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={handleFormatClick}
                                disabled={!localSql || !canFormat}
                              >
                                Format
                              </Button>
                              <Button
                                size="xs"
                                disabled={!canRunPreview}
                                loading={loading}
                                onClick={() => previewQuery(localSql)}
                                icon={<PiPlay />}
                              >
                                Run
                              </Button>
                              {!showHeader ? queryHelp : null}
                              <DropdownMenu
                                trigger={
                                  <IconButton
                                    variant="ghost"
                                    color="gray"
                                    radius="full"
                                    size="2"
                                    aria-label="SQL editor options"
                                  >
                                    <BsThreeDotsVertical size={16} />
                                  </IconButton>
                                }
                              >
                                <DropdownMenuItem
                                  onClick={() =>
                                    setIsAutocompleteEnabled(
                                      !isAutocompleteEnabled,
                                    )
                                  }
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
                        {prompt}
                        <CodeTextArea
                          wrapperClassName={styles["sql-editor-wrapper"]}
                          language="sql"
                          value={localSql}
                          setValue={(sql) => {
                            setLocalSql(sql);
                            setError(null);
                            setFormatError(null);
                            setPreviewResult(null);
                          }}
                          setCursorData={setCursorData}
                          onCtrlEnter={() => previewQuery(localSql)}
                          completions={autoCompletions}
                          fullHeight
                          placeholder={SQL_PLACEHOLDER}
                        />
                      </AreaWithHeader>
                    </Panel>
                    {previewResult && (
                      <>
                        <PanelResizeHandle />
                        <Panel
                          id="sql-query-preview"
                          order={2}
                          defaultSize={40}
                          minSize={15}
                        >
                          <DisplayTestQueryResults
                            duration={previewResult.duration ?? 0}
                            results={previewResult.results ?? []}
                            sql={previewResult.sql ?? localSql}
                            error={error ?? previewResult.error ?? ""}
                            allowDownload
                            rowsLabel={
                              previewResult.results?.length ===
                              PREVIEW_ROW_LIMIT
                                ? `Showing the first ${PREVIEW_ROW_LIMIT} rows`
                                : undefined
                            }
                          />
                        </Panel>
                      </>
                    )}
                  </PanelGroup>
                </Panel>
              </PanelGroup>
            </Flex>
          )}
        </Box>
      )}
    </AiSqlGenerator>
  );

  return content;
}
