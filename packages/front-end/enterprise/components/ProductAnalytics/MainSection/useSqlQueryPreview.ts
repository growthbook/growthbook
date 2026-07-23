import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExplorationConfig,
  QueryExecutionResult,
  SqlValue,
  type SqlDataset,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  createEmptyValue,
  getInferredTimestampColumn,
} from "@/enterprise/components/ProductAnalytics/util";

export const PREVIEW_ROW_LIMIT = 100;

type SqlQueryPreviewState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "success"; result: QueryExecutionResult; error: null }
  | { status: "error"; result: QueryExecutionResult; error: string };

const idleState: SqlQueryPreviewState = {
  status: "idle",
  result: null,
  error: null,
};

export default function useSqlQueryPreview({
  dataset,
  datasourceId,
  onChartReadyChange,
  onRunStart,
  onRunSuccess,
  onRunError,
}: {
  dataset: SqlDataset | null;
  datasourceId: string;
  onChartReadyChange?: (ready: boolean) => void;
  onRunStart?: () => void;
  onRunSuccess?: () => void;
  onRunError?: () => void;
}) {
  const { apiCall } = useAuth();
  const { setDraftExploreState } = useExplorerContext();
  const [state, setState] = useState<SqlQueryPreviewState>(idleState);
  const lastPreviewedSqlRef = useRef<string | null>(null);

  useEffect(() => {
    if ((dataset?.sql ?? "") !== lastPreviewedSqlRef.current) {
      setState(idleState);
    }
  }, [dataset?.sql]);

  useEffect(() => {
    lastPreviewedSqlRef.current = null;
    setState(idleState);
  }, [datasourceId]);

  const chartReady =
    state.status !== "loading" &&
    state.status !== "error" &&
    dataset !== null &&
    dataset.sql.trim().length > 0 &&
    dataset.timestampColumn.length > 0 &&
    dataset.columnTypes[dataset.timestampColumn] === "date" &&
    Object.keys(dataset.columnTypes).length > 0;

  useEffect(() => {
    onChartReadyChange?.(chartReady);
  }, [chartReady, onChartReadyChange]);

  const applyColumnMetadata = useCallback(
    (
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
            (dimension) => dimension.dimensionType !== "dynamic",
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
    },
    [setDraftExploreState],
  );

  const runQuery = useCallback(
    async (sql: string): Promise<boolean> => {
      if (!sql.trim() || !datasourceId) return false;

      onRunStart?.();
      setState({ status: "loading", result: null, error: null });

      try {
        const response = await apiCall<QueryExecutionResult>("/query/run", {
          method: "POST",
          body: JSON.stringify({
            datasourceId,
            query: sql,
            limit: PREVIEW_ROW_LIMIT,
          }),
        });
        const result = {
          ...response,
          sql: response.sql || sql,
        };

        if (response.error) {
          setState({ status: "error", result, error: response.error });
          onRunError?.();
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

        if (dateColumns.length === 0) {
          const error =
            "Your SQL query must return at least one date or timestamp column.";
          setState({ status: "error", result, error });
          onRunError?.();
          return false;
        }

        lastPreviewedSqlRef.current = sql;
        applyColumnMetadata(sql, columnTypes, timestampColumn);
        setState({ status: "success", result, error: null });
        onRunSuccess?.();
        return true;
      } catch (caught) {
        const error = caught instanceof Error ? caught.message : String(caught);
        setState({
          status: "error",
          error,
          result: {
            error,
            results: [],
            sql,
          },
        });
        onRunError?.();
        return false;
      }
    },
    [
      apiCall,
      applyColumnMetadata,
      datasourceId,
      onRunError,
      onRunStart,
      onRunSuccess,
    ],
  );

  return {
    status: state.status,
    loading: state.status === "loading",
    error: state.error,
    previewResult: state.result,
    runQuery,
  };
}
