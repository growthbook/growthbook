import React, { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  PiArrowRight,
  PiCaretDown,
  PiCaretRight,
  PiPlay,
  PiQuestion,
  PiWarningFill,
} from "react-icons/pi";
import type { ImperativePanelHandle } from "react-resizable-panels";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import styles from "@/components/SchemaBrowser/EditSqlModal.module.scss";
import { useAISettings } from "@/hooks/useOrgSettings";
import useSqlQueryPreview, { PREVIEW_ROW_LIMIT } from "./useSqlQueryPreview";
const SQL_PLACEHOLDER = `SELECT
    orderId,
    orderDate,
    total,
    itemsCount,
    userId
FROM
    orders`;

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
          <PiWarningFill className="text-danger" />
        </Tooltip>
      ) : null}
      {aiTrigger}
      <Button
        size="sm"
        disabled={!canRun}
        loading={loading}
        onClick={onRun}
        icon={<PiPlay />}
      >
        Test query
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
  onRunStart,
  onRunSuccess,
  onRunError,
  resultsTarget,
  onOpenChange,
  onPreviewPresenceChange,
}: {
  fullHeight?: boolean;
  showHeader?: boolean;
  onRunStart?: () => void;
  onRunSuccess?: () => void;
  onRunError?: () => void;
  resultsTarget?: HTMLDivElement | null;
  onOpenChange?: (open: boolean) => void;
  onPreviewPresenceChange?: (hasPreview: boolean) => void;
}) {
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { aiEnabled } = useAISettings();
  const { draftExploreState } = useExplorerContext();
  const dataset =
    draftExploreState.dataset.type === "sql" ? draftExploreState.dataset : null;
  const datasource = draftExploreState.datasource
    ? getDatasourceById(draftExploreState.datasource)
    : null;
  const canRunQueries = datasource
    ? permissionsUtil.canRunSqlExplorerQueries(datasource)
    : false;
  const {
    autoCompletions,
    isAutocompleteEnabled,
    localSql,
    setLocalSql,
    setCursorData,
    setIsAutocompleteEnabled,
    exploreReady,
    setViewMode,
    markExploreSeen,
  } = useSqlEditorContext();

  const [open, setOpen] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
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
    onRunStart,
    onRunSuccess,
    onRunError,
  });

  useEffect(() => {
    if ((status === "success" || status === "error") && !resultsTarget) {
      const lineCount = Math.max(localSql.split("\n").length, 1);
      // Nested editor/results split: roughly fit SQL, capped well below 50%.
      const percent = Math.min(60, Math.max(20, 12 + lineCount * 2));
      editorPanelRef.current?.resize(percent);
    }
  }, [localSql, resultsTarget, status]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    onPreviewPresenceChange?.(status !== "idle");
  }, [onPreviewPresenceChange, status]);

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

  const canRunPreview =
    !loading &&
    !aiLoading &&
    !!localSql.trim() &&
    !!draftExploreState.datasource &&
    canRunQueries;
  const canFormat =
    !loading && datasource ? canFormatSql(datasource.type) : false;
  const showContent = open || !showHeader;
  const previewRowCount = previewResult?.results?.length ?? 0;
  const previewContent =
    status === "idle" ? null : (
      <DisplayTestQueryResults
        duration={previewResult?.duration ?? 0}
        results={previewResult?.results ?? []}
        sql={previewResult?.sql ?? localSql}
        error={error ?? previewResult?.error ?? ""}
        allowDownload={status === "success"}
        showNoRowsWarning={status === "success"}
        resultsHeader="Sample Results"
        emptyResultsContent={
          status === "loading" ? (
            <Flex
              align="center"
              justify="center"
              height="100%"
              style={{ color: "var(--color-text-mid)" }}
            >
              <Text>Running query...</Text>
            </Flex>
          ) : undefined
        }
        rowsLabel={
          status === "success" && previewRowCount > 0 ? (
            <Flex align="center" gap="3" wrap="wrap">
              <Text as="span" size="sm" weight="medium">
                {previewRowCount === PREVIEW_ROW_LIMIT
                  ? `Showing the first ${PREVIEW_ROW_LIMIT} rows`
                  : `${previewRowCount} rows`}
              </Text>
              {exploreReady ? (
                <Link
                  size="sm"
                  weight="medium"
                  onClick={() => {
                    markExploreSeen();
                    setViewMode("explore");
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  Explore full dataset
                  <PiArrowRight size={14} aria-hidden />
                </Link>
              ) : null}
            </Flex>
          ) : undefined
        }
      />
    );
  const queryHelp = (
    <Tooltip
      body={
        <Flex direction="column" gap="2">
          <Text>
            Write a read-only query that returns the rows you want to analyze.
            Include a date or timestamp column to enable date filtering,
            comparisons, and time-series charts.
          </Text>
          <Text>
            Test the query to preview sample rows, then explore full results to
            aggregate, filter, and chart without rewriting SQL. Use the Schema
            Browser on the side bar to see what data is available, and
            optionally use our AI SQL Generator to help write the query.
          </Text>
        </Flex>
      }
      usePortal
    >
      <Button size="sm" variant="ghost" icon={<PiQuestion />}>
        Need help?
      </Button>
    </Tooltip>
  );

  const content = (
    <AiSqlGenerator
      datasourceId={draftExploreState.datasource}
      disabled={loading || !canRunQueries || !aiEnabled}
      onLoadingChange={setAiLoading}
      onSqlGenerated={(sql) => {
        setLocalSql(sql);
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
                          disabled={loading || !canRunQueries}
                          setCursorData={setCursorData}
                          onCtrlEnter={() => {
                            if (canRunPreview) {
                              void previewQuery(localSql);
                            }
                          }}
                          completions={autoCompletions}
                          fullHeight
                          paddingTop={8}
                          placeholder={SQL_PLACEHOLDER}
                        />
                      </AreaWithHeader>
                    </Panel>
                    {!resultsTarget && previewContent ? (
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
                    ) : null}
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
