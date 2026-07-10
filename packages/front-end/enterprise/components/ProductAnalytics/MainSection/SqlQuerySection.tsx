import React, { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight, PiPlay } from "react-icons/pi";
import {
  ExplorationConfig,
  SqlValue,
  type SqlDataset,
} from "shared/validators";
import CodeTextArea from "@/components/Forms/CodeTextArea";
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
import { CursorData } from "@/components/Segments/SegmentForm";
import {
  createEmptyValue,
  getInferredTimestampColumn,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

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

  const [open, setOpen] = useState(true);
  const [localSql, setLocalSql] = useState(dataset?.sql ?? "");
  const [cursorData, setCursorData] = useState<CursorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSuccess, setPreviewSuccess] = useState(false);

  useEffect(() => {
    setLocalSql(dataset?.sql ?? "");
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

  const previewColumns = async (sql: string): Promise<boolean> => {
    if (!sql.trim() || !draftExploreState.datasource) return false;
    setLoading(true);
    setError(null);
    setPreviewSuccess(false);
    try {
      const response = await apiCall<{
        status: number;
        columns: {
          column: string;
          type: "string" | "number" | "date" | "boolean" | "other";
        }[];
      }>("/product-analytics/sql-columns", {
        method: "POST",
        body: JSON.stringify({
          datasource: draftExploreState.datasource,
          sql,
        }),
      });

      const columnTypes = Object.fromEntries(
        response.columns.map((column) => [column.column, column.type]),
      ) as SqlDataset["columnTypes"];
      const dateColumns = response.columns
        .filter((column) => column.type === "date")
        .map((column) => column.column);
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
      return false;
    } finally {
      setLoading(false);
    }
  };

  const sqlChanged = localSql !== dataset.sql;
  const canRunPreview = !!localSql.trim() && !!draftExploreState.datasource;

  return (
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
        style={{ borderBottom: open ? "1px solid var(--gray-a3)" : undefined }}
      >
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          <Flex align="center" gap="2">
            {open ? <PiCaretDown /> : <PiCaretRight />}
            <Text weight="medium">Query</Text>
          </Flex>
        </Button>
        <Flex align="center" gap="2">
          {sqlChanged ? (
            <Text size="small" color="text-low">
              Unsaved query changes
            </Text>
          ) : null}
          {open && (
            <Button
              size="xs"
              aria-label="Run query"
              title="Run query"
              disabled={!canRunPreview}
              loading={loading}
              onClick={() => previewColumns(localSql)}
            >
              <Flex align="center" gap="2">
                <PiPlay />
                Run
              </Flex>
            </Button>
          )}
        </Flex>
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
          <Text size="small" color="text-low">
            Write a read-only query that returns rows with at least one date or
            timestamp column. Run the query to detect output columns for values,
            dimensions, and date filtering.
          </Text>
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
            <Panel defaultSize={65} minSize={45}>
              <Flex direction="column" height="100%" pr="3">
                <CodeTextArea
                  language="sql"
                  value={localSql}
                  setValue={(sql) => {
                    setLocalSql(sql);
                    setError(null);
                    setPreviewSuccess(false);
                  }}
                  setCursorData={setCursorData}
                  fullHeight
                  placeholder="SELECT timestamp, user_id, event_name FROM events"
                />
              </Flex>
            </Panel>
            {datasource && (
              <>
                <PanelResizeHandle />
                <Panel defaultSize={35} minSize={25}>
                  <Flex direction="column" height="100%" pl="3">
                    <Text weight="medium" mb="2">
                      Schema Browser
                    </Text>
                    <SchemaBrowser
                      datasource={datasource}
                      cursorData={cursorData ?? undefined}
                      updateSqlInput={(sql) => {
                        setLocalSql(sql);
                        setError(null);
                        setPreviewSuccess(false);
                      }}
                    />
                  </Flex>
                </Panel>
              </>
            )}
          </PanelGroup>
        </Flex>
      )}
    </Box>
  );
}
