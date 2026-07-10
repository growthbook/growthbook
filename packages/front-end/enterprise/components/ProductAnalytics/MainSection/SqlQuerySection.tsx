import React, { useEffect, useRef, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaExclamationTriangle } from "react-icons/fa";
import {
  PiCaretDoubleLeft,
  PiCaretDown,
  PiCaretRight,
  PiDotsSix,
  PiPlay,
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
import Callout from "@/ui/Callout";
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
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";

const PREVIEW_ROW_LIMIT = 100;
const SQL_PLACEHOLDER = `-- Write a read-only query that returns rows with at least one date or
-- timestamp column.

SELECT timestamp, user_id, event_name FROM events`;

export default function SqlQuerySection({
  fullHeight = false,
}: {
  fullHeight?: boolean;
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
  const [previewSuccess, setPreviewSuccess] = useState(false);
  const [previewResult, setPreviewResult] =
    useState<QueryExecutionResult | null>(null);
  const [schemaCollapsed, setSchemaCollapsed] = useState(false);
  const schemaPanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    setLocalSql(dataset?.sql ?? "");
    setPreviewResult(null);
  }, [dataset?.sql]);

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
    setPreviewSuccess(false);
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

      applyColumnMetadata(sql, columnTypes, timestampColumn);

      if (dateColumns.length === 0) {
        setError(
          "Your SQL query must return at least one date or timestamp column.",
        );
        return false;
      }

      setPreviewSuccess(true);
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

  return (
    <AiSqlGenerator
      datasourceId={draftExploreState.datasource}
      onSqlGenerated={(sql) => {
        setLocalSql(sql);
        setError(null);
        setPreviewResult(null);
        setPreviewSuccess(false);
      }}
    >
      {({ prompt, trigger }) => (
        <Box
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-4)",
            backgroundColor: "var(--color-panel-translucent)",
            overflow: "hidden",
            flex: fullHeight ? 1 : undefined,
            minHeight: fullHeight ? 0 : undefined,
            display: fullHeight ? "flex" : undefined,
            flexDirection: fullHeight ? "column" : undefined,
          }}
        >
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
            {sqlChanged ? (
              <Text size="small" color="text-low">
                Unsaved query changes
              </Text>
            ) : null}
          </Flex>
          {open && (
            <Flex
              direction="column"
              gap="3"
              p="3"
              style={{
                flex: fullHeight ? 1 : undefined,
                minHeight: fullHeight ? 0 : undefined,
              }}
            >
              {error && <Callout status="error">{error}</Callout>}
              {previewSuccess && !error && (
                <Callout status="success">
                  Query columns were detected successfully.
                </Callout>
              )}
              <PanelGroup
                direction="horizontal"
                style={{
                  minHeight: fullHeight ? 0 : 360,
                  flex: fullHeight ? 1 : undefined,
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
                            <Flex align="center" gap="2">
                              <Button
                                variant="outline"
                                size="xs"
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
                              </Button>
                              {!schemaCollapsed ? (
                                <Text weight="medium">Schema Browser</Text>
                              ) : null}
                            </Flex>
                          }
                          headerStyles={
                            schemaCollapsed
                              ? {
                                  padding: "8px",
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
                                setPreviewSuccess(false);
                              }}
                            />
                          </Box>
                        </AreaWithHeader>
                      </Flex>
                    </Panel>
                    {!schemaCollapsed && (
                      <PanelResizeHandle
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <PiDotsSix
                          size={16}
                          style={{ transform: "rotate(90deg)" }}
                        />
                      </PanelResizeHandle>
                    )}
                  </>
                )}
                <Panel
                  order={2}
                  defaultSize={datasource ? 65 : 100}
                  minSize={45}
                >
                  <PanelGroup direction="vertical">
                    <Panel
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
                            setPreviewSuccess(false);
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
                            error={previewResult.error ?? ""}
                            close={() => setPreviewResult(null)}
                            allowDownload
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
}
