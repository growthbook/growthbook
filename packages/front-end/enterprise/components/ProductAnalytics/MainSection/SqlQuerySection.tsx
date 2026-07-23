import React, { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaExclamationTriangle } from "react-icons/fa";
import { PiCaretDown, PiCaretRight, PiPlay, PiQuestion } from "react-icons/pi";
import type { ImperativePanelHandle } from "react-resizable-panels";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import DisplayTestQueryResults, {
  type AdditionalQueryResultsTab,
} from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
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
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";
import useSqlQueryPreview, { PREVIEW_ROW_LIMIT } from "./useSqlQueryPreview";
const SQL_PLACEHOLDER = `SELECT timestamp, user_id, event_name FROM events`;

function SqlQueryActions({
  aiTrigger,
  canFormat,
  canRun,
  formatError,
  isAutocompleteEnabled,
  loading,
  onFormat,
  onRun,
  onToggleAutocomplete,
  queryHelp,
}: {
  aiTrigger: ReactNode;
  canFormat: boolean;
  canRun: boolean;
  formatError: string | null;
  isAutocompleteEnabled: boolean;
  loading: boolean;
  onFormat: () => void;
  onRun: () => void;
  onToggleAutocomplete: () => void;
  queryHelp?: ReactNode;
}) {
  return (
    <>
      {formatError ? (
        <Tooltip body={formatError}>
          <FaExclamationTriangle className="text-danger" />
        </Tooltip>
      ) : null}
      {aiTrigger}
      <Button
        size="xs"
        disabled={!canRun}
        loading={loading}
        onClick={onRun}
        icon={<PiPlay />}
      >
        Run
      </Button>
      {queryHelp}
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
        <DropdownMenuItem onClick={onFormat} disabled={!canFormat}>
          Format
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleAutocomplete}>
          {isAutocompleteEnabled
            ? "Disable Autocomplete"
            : "Enable Autocomplete"}
        </DropdownMenuItem>
      </DropdownMenu>
    </>
  );
}

export default function SqlQuerySection({
  fullHeight = false,
  showHeader = true,
  onChartReadyChange,
  onRunStart,
  onRunSuccess,
  onRunError,
  resultsTarget,
  activeResultsTab,
  onResultsTabChange,
  additionalResultsTab,
  onOpenChange,
  onQueryFocus,
}: {
  fullHeight?: boolean;
  showHeader?: boolean;
  onChartReadyChange?: (ready: boolean) => void;
  onRunStart?: () => void;
  onRunSuccess?: () => void;
  onRunError?: () => void;
  resultsTarget?: HTMLDivElement | null;
  activeResultsTab?: string;
  onResultsTabChange?: (value: string) => void;
  additionalResultsTab?: AdditionalQueryResultsTab;
  onOpenChange?: (open: boolean) => void;
  onQueryFocus?: () => void;
}) {
  const { getDatasourceById } = useDefinitions();
  const { draftExploreState } = useExplorerContext();
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
  } = useSqlEditorContext();

  const [open, setOpen] = useState(true);
  const [formatError, setFormatError] = useState<string | null>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const {
    status,
    loading,
    error,
    previewResult,
    runQuery: previewQuery,
  } = useSqlQueryPreview({
    dataset,
    datasourceId: draftExploreState.datasource,
    onChartReadyChange,
    onRunStart,
    onRunSuccess,
    onRunError,
  });

  useEffect(() => {
    if (status === "success" && !resultsTarget) {
      editorPanelRef.current?.resize(30);
    }
  }, [resultsTarget, status]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  if (!dataset) return null;

  const handleFormatClick = () => {
    const result = formatSql(localSql, datasource?.type);
    if (result.error) {
      setFormatError(result.error);
    } else if (result.formattedSql) {
      setLocalSql(result.formattedSql);
      setFormatError(null);
    }
  };

  const canRunPreview = !!localSql.trim() && !!draftExploreState.datasource;
  const canFormat = datasource ? canFormatSql(datasource.type) : false;
  const showContent = open || !showHeader;
  const previewContent =
    previewResult || additionalResultsTab ? (
      <DisplayTestQueryResults
        duration={previewResult?.duration ?? 0}
        results={previewResult?.results ?? []}
        sql={previewResult?.sql ?? localSql}
        error={error ?? previewResult?.error ?? ""}
        allowDownload
        activeTab={activeResultsTab}
        onTabChange={onResultsTabChange}
        additionalTab={additionalResultsTab}
        showNoRowsWarning={previewResult !== null}
        emptyResultsContent={
          !previewResult ? (
            <Flex
              align="center"
              justify="center"
              height="100%"
              style={{ color: "var(--color-text-mid)" }}
            >
              <Text>Run a SQL query to see results.</Text>
            </Flex>
          ) : undefined
        }
        rowsLabel={
          previewResult?.results?.length === PREVIEW_ROW_LIMIT
            ? `Showing the first ${PREVIEW_ROW_LIMIT} rows`
            : undefined
        }
      />
    ) : null;
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
      }}
    >
      {({ prompt, trigger }) => (
        <Box
          onPointerDown={onQueryFocus}
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
              <Flex align="center" gap="2">
                <Button variant="ghost" onClick={() => setOpen(!open)}>
                  <Flex align="center" gap="2">
                    {open ? <PiCaretDown /> : <PiCaretRight />}
                    <Text weight="medium">Query</Text>
                  </Flex>
                </Button>
              </Flex>
              <Flex align="center" gap="2" mr="1">
                {open ? (
                  <SqlQueryActions
                    aiTrigger={trigger}
                    canFormat={Boolean(localSql) && canFormat}
                    canRun={canRunPreview}
                    formatError={formatError}
                    isAutocompleteEnabled={isAutocompleteEnabled}
                    loading={loading}
                    onFormat={handleFormatClick}
                    onRun={() => void previewQuery(localSql)}
                    onToggleAutocomplete={() =>
                      setIsAutocompleteEnabled(!isAutocompleteEnabled)
                    }
                  />
                ) : null}
              </Flex>
            </Flex>
          ) : null}
          {showContent && (
            <Flex
              direction="column"
              gap="3"
              p="0"
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
                      defaultSize={previewResult && !resultsTarget ? 60 : 100}
                      minSize={30}
                    >
                      <AreaWithHeader
                        hideHeader={showHeader}
                        borderless={showHeader}
                        header={
                          <Flex align="center" justify="between" gap="3">
                            <Flex align="center" gap="2">
                              <Text weight="medium">SQL</Text>
                            </Flex>
                            <Flex align="center" gap="2">
                              <SqlQueryActions
                                aiTrigger={trigger}
                                canFormat={Boolean(localSql) && canFormat}
                                canRun={canRunPreview}
                                formatError={formatError}
                                isAutocompleteEnabled={isAutocompleteEnabled}
                                loading={loading}
                                onFormat={handleFormatClick}
                                onRun={() => void previewQuery(localSql)}
                                onToggleAutocomplete={() =>
                                  setIsAutocompleteEnabled(
                                    !isAutocompleteEnabled,
                                  )
                                }
                                queryHelp={!showHeader ? queryHelp : undefined}
                              />
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
                            setFormatError(null);
                          }}
                          setCursorData={setCursorData}
                          onCtrlEnter={() => previewQuery(localSql)}
                          completions={autoCompletions}
                          fullHeight
                          paddingTop={8}
                          placeholder={SQL_PLACEHOLDER}
                        />
                      </AreaWithHeader>
                    </Panel>
                    {previewResult && !resultsTarget && (
                      <>
                        <PanelResizeHandle />
                        <Panel
                          id="sql-query-preview"
                          order={2}
                          defaultSize={40}
                          minSize={15}
                        >
                          {previewContent}
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

  return (
    <>
      {content}
      {resultsTarget && previewContent
        ? createPortal(previewContent, resultsTarget)
        : null}
    </>
  );
}
