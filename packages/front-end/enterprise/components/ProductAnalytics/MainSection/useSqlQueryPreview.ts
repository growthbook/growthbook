import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExplorationConfig,
  QueryExecutionResult,
  type SqlDataset,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import { getInferredTimestampColumn } from "@/enterprise/components/ProductAnalytics/util";

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
  onRunStart,
  onRunSuccess,
  onRunError,
}: {
  dataset: SqlDataset | null;
  datasourceId: string;
  onRunStart?: () => void;
  onRunSuccess?: () => void;
  onRunError?: () => void;
}) {
  const { apiCall } = useAuth();
  const { setDraftExploreState } = useExplorerContext();
  const { localSql, setIsQueryRunning, setExploreReady } =
    useSqlEditorContext();
  const [state, setState] = useState<SqlQueryPreviewState>(idleState);
  const lastPreviewedSqlRef = useRef<string | null>(null);

  useEffect(() => {
    const datasetSql = dataset?.sql ?? "";
    if (
      lastPreviewedSqlRef.current !== null &&
      datasetSql !== lastPreviewedSqlRef.current
    ) {
      lastPreviewedSqlRef.current = null;
      setState(idleState);
    }
  }, [dataset?.sql]);

  useEffect(() => {
    lastPreviewedSqlRef.current = null;
    setState(idleState);
  }, [datasourceId]);

  // Ready when columns exist and the editor matches the tested dataset SQL.
  // Covers both a successful in-session test and configs loaded from a URL/dashboard.
  const exploreReady =
    state.status !== "loading" &&
    state.status !== "error" &&
    dataset !== null &&
    localSql.trim().length > 0 &&
    localSql === dataset.sql &&
    Object.keys(dataset.columnTypes).length > 0;

  useEffect(() => {
    setExploreReady(exploreReady);
  }, [exploreReady, setExploreReady]);

  const applyColumnMetadata = useCallback(
    (
      sql: string,
      columnTypes: SqlDataset["columnTypes"],
      timestampColumn: string | null,
    ) => {
      setDraftExploreState((prev) => {
        if (prev.dataset.type !== "sql") return prev;
        const valueColumns = new Set(Object.keys(columnTypes));
        const shouldDefaultToLine =
          prev.dataset.timestampColumn === null &&
          timestampColumn !== null &&
          (prev.chartType === "bar" || prev.chartType === "table");
        const dimensions = prev.dimensions.filter(
          (dimension) =>
            dimension.dimensionType !== "dynamic" ||
            dimension.column === null ||
            valueColumns.has(dimension.column),
        );
        return {
          ...prev,
          chartType: shouldDefaultToLine ? "line" : prev.chartType,
          dimensions:
            shouldDefaultToLine &&
            !dimensions.some((dimension) => dimension.dimensionType === "date")
              ? [
                  {
                    dimensionType: "date",
                    column: "date",
                    dateGranularity: "auto",
                  },
                  ...dimensions,
                ]
              : dimensions,
          dataset: {
            ...prev.dataset,
            sql,
            columnTypes,
            timestampColumn,
            values: prev.dataset.values.map((value) => ({
              ...value,
              valueColumn:
                value.valueColumn && valueColumns.has(value.valueColumn)
                  ? value.valueColumn
                  : null,
            })),
          },
        } as ExplorationConfig;
      });
    },
    [setDraftExploreState],
  );

  const runQuery = useCallback(
    async (sql: string): Promise<boolean> => {
      if (!sql.trim() || !datasourceId) return false;

      setIsQueryRunning(true);
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
            : (dateColumns[0] ?? null);

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
      } finally {
        setIsQueryRunning(false);
      }
    },
    [
      apiCall,
      applyColumnMetadata,
      datasourceId,
      onRunError,
      onRunStart,
      onRunSuccess,
      setIsQueryRunning,
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
