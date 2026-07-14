import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaExclamationTriangle } from "react-icons/fa";
import {
  PiArrowsOut,
  PiCaretDoubleLeft,
  PiCaretDown,
  PiCaretRight,
  PiDotsSix,
  PiPlay,
  PiX,
} from "react-icons/pi";
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
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import AiSqlGenerator from "@/components/SchemaBrowser/AiSqlGenerator";
import AreaWithHeader from "@/components/SchemaBrowser/AreaWithHeader";
import useSqlAutocomplete from "@/components/SchemaBrowser/useSqlAutocomplete";
import Tooltip from "@/components/Tooltip/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { canFormatSql, formatSql } from "@/services/sqlFormatter";
import {
  createEmptyValue,
  getInferredTimestampColumn,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { RadixTheme } from "@/services/RadixTheme";
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";

const PREVIEW_ROW_LIMIT = 100;
const SQL_PLACEHOLDER = `-- Write a read-only query that returns rows with at least one date or
-- timestamp column.

SELECT timestamp, user_id, event_name FROM events`;

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
    cursorData,
    isAutocompleteEnabled,
    setCursorData,
    setIsAutocompleteEnabled,
  } = useSqlAutocomplete({
    datasourceId: draftExploreState.datasource,
    source: "SqlExplorer",
    skipManagedWarehouseUnavailable: true,
  });

  const [open, setOpen] = useState(true);
  const [localSql, setLocalSql] = useState(dataset?.sql ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] =
    useState<QueryExecutionResult | null>(null);
  const [schemaCollapsed, setSchemaCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const schemaPanelRef = useRef<ImperativePanelHandle>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const lastPreviewedSqlRef = useRef<string | null>(null);
  const collapseAfterSuccessfulRunRef = useRef(false);

  useEffect(() => {
    setLocalSql(dataset?.sql ?? "");
    if ((dataset?.sql ?? "") !== lastPreviewedSqlRef.current) {
      setPreviewResult(null);
    }
  }, [dataset?.sql]);

  useEffect(() => {
    lastPreviewedSqlRef.current = null;
    setPreviewResult(null);
  }, [draftExploreState.datasource]);

  useEffect(() => {
    if (!previewResult || error || !collapseAfterSuccessfulRunRef.current) {
      return;
    }
    collapseAfterSuccessfulRunRef.current = false;
    if (!isFullscreen) {
      schemaPanelRef.current?.collapse();
    }
    editorPanelRef.current?.resize(30);
  }, [error, isFullscreen, previewResult]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

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

  const toggleSchema = () => {
    if (schemaCollapsed) {
      schemaPanelRef.current?.expand();
    } else {
      schemaPanelRef.current?.collapse();
    }
  };

  const sqlChanged = localSql !== dataset.sql;
  const canRunPreview = !!localSql.trim() && !!draftExploreState.datasource;
  const canFormat = datasource ? canFormatSql(datasource.type) : false;
  const useFullHeight = fullHeight || isFullscreen;
  const showSectionHeader = showHeader || isFullscreen;

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
            border: showSectionHeader ? "1px solid var(--gray-a3)" : undefined,
            borderRadius: isFullscreen
              ? 0
              : showHeader
                ? "var(--radius-4)"
                : undefined,
            backgroundColor: isFullscreen
              ? "var(--color-surface-solid)"
              : showHeader
                ? "var(--color-panel-translucent)"
                : undefined,
            overflow: "hidden",
            flex: useFullHeight ? 1 : undefined,
            minHeight: useFullHeight ? 0 : undefined,
            display: useFullHeight ? "flex" : undefined,
            flexDirection: useFullHeight ? "column" : undefined,
            position: isFullscreen ? "fixed" : undefined,
            inset: isFullscreen ? 0 : undefined,
            zIndex: isFullscreen ? 9500 : undefined,
          }}
        >
          {showSectionHeader ? (
            <Flex
              align="center"
              justify="between"
              p="3"
              style={{
                borderBottom: open ? "1px solid var(--gray-a3)" : undefined,
              }}
            >
              {isFullscreen ? (
                <Flex align="center" gap="2">
                  <Text weight="medium">Query</Text>
                </Flex>
              ) : (
                <Button variant="ghost" onClick={() => setOpen(!open)}>
                  <Flex align="center" gap="2">
                    {open ? <PiCaretDown /> : <PiCaretRight />}
                    <Text weight="medium">Query</Text>
                  </Flex>
                </Button>
              )}
              <Flex align="center" justify="between" gap="3" mr="1">
                {sqlChanged ? (
                  <Text size="small" color="text-low">
                    Unsaved query changes
                  </Text>
                ) : null}
                {open ? (
                  <Tooltip
                    style={{ display: "flex", alignItems: "center" }}
                    body={
                      isFullscreen
                        ? "Close full screen (ESC)"
                        : "Open in full screen"
                    }
                  >
                    <IconButton
                      size="2"
                      variant="ghost"
                      color="gray"
                      aria-label={
                        isFullscreen
                          ? "Close full screen"
                          : "Open in full screen"
                      }
                      onClick={() => {
                        if (!isFullscreen) {
                          setOpen(true);
                        }
                        setIsFullscreen(!isFullscreen);
                      }}
                    >
                      {isFullscreen ? <PiX /> : <PiArrowsOut />}
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Flex>
            </Flex>
          ) : null}
          {(open || !showHeader) && (
            <Flex
              direction="column"
              gap="3"
              p={showSectionHeader ? "3" : "0"}
              style={{
                flex: useFullHeight ? 1 : undefined,
                minHeight: useFullHeight ? 0 : undefined,
              }}
            >
              <PanelGroup
                direction="horizontal"
                style={{
                  minHeight: useFullHeight ? 0 : 360,
                  flex: useFullHeight ? 1 : undefined,
                }}
              >
                {datasource && (
                  <>
                    <Panel
                      ref={schemaPanelRef}
                      order={1}
                      defaultSize={35}
                      minSize={20}
                      collapsible
                      collapsedSize={5}
                      onCollapse={() => setSchemaCollapsed(true)}
                      onExpand={() => setSchemaCollapsed(false)}
                    >
                      <Flex direction="column" height="100%" width="100%">
                        <AreaWithHeader
                          header={
                            <Flex
                              align="center"
                              justify={schemaCollapsed ? "center" : "start"}
                              gap="2"
                              width="100%"
                            >
                              <IconButton
                                variant="ghost"
                                size="1"
                                aria-label={
                                  schemaCollapsed
                                    ? "Show schema browser"
                                    : "Hide schema browser"
                                }
                                title={
                                  schemaCollapsed
                                    ? "Show schema browser"
                                    : "Hide schema browser"
                                }
                                onClick={toggleSchema}
                              >
                                <PiCaretDoubleLeft
                                  style={{
                                    transform: schemaCollapsed
                                      ? "rotate(180deg)"
                                      : "rotate(0deg)",
                                    transition: "transform 0.5s ease",
                                  }}
                                />
                              </IconButton>
                              {!schemaCollapsed ? (
                                <Text weight="medium">Schema Browser</Text>
                              ) : null}
                            </Flex>
                          }
                          headerStyles={
                            schemaCollapsed
                              ? {
                                  padding: "12px 4px 8px",
                                }
                              : undefined
                          }
                        >
                          <Box
                            height="100%"
                            style={{
                              display: schemaCollapsed ? "none" : undefined,
                            }}
                          >
                            <SchemaBrowser
                              datasource={datasource}
                              cursorData={cursorData ?? undefined}
                              updateSqlInput={(sql) => {
                                setLocalSql(sql);
                                setError(null);
                                setPreviewResult(null);
                              }}
                            />
                          </Box>
                        </AreaWithHeader>
                      </Flex>
                    </Panel>
                    <PanelResizeHandle
                      style={{
                        alignSelf: "stretch",
                        height: "auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <PiDotsSix
                        size={16}
                        style={{ transform: "rotate(90deg)" }}
                      />
                    </PanelResizeHandle>
                  </>
                )}
                <Panel
                  order={2}
                  defaultSize={datasource ? 65 : 100}
                  minSize={45}
                >
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
                              {!showHeader && !isFullscreen ? (
                                <Tooltip body="Open in full screen">
                                  <IconButton
                                    size="2"
                                    variant="ghost"
                                    color="gray"
                                    aria-label="Open in full screen"
                                    onClick={() => {
                                      setOpen(true);
                                      setIsFullscreen(true);
                                    }}
                                  >
                                    <PiArrowsOut />
                                  </IconButton>
                                </Tooltip>
                              ) : null}
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

  return isFullscreen && typeof document !== "undefined"
    ? createPortal(<RadixTheme>{content}</RadixTheme>, document.body)
    : content;
}
