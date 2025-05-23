import { useState, useCallback } from "react";
import { format, FormatOptionsWithLanguage } from "sql-formatter";
import { DataSourceType } from "back-end/types/datasource";

interface FormattingState {
  error: string | null;
  originalSql: string | null;
  formattedSql: string | null;
}

function getSqlFormatterLanguage(
  datasourceType?: DataSourceType
): FormatOptionsWithLanguage["language"] {
  const typeMap: Record<
    DataSourceType,
    FormatOptionsWithLanguage["language"]
  > = {
    redshift: "redshift",
    snowflake: "snowflake",
    mysql: "mysql",
    bigquery: "bigquery",
    postgres: "postgresql",
    mssql: "transactsql",
    clickhouse: "sql",
    growthbook_clickhouse: "sql",
    athena: "sql",
    presto: "trino",
    databricks: "spark",
    vertica: "sql",
    mixpanel: "sql",
    google_analytics: "sql",
  };

  return datasourceType ? typeMap[datasourceType] : "sql";
}

function replaceTemplateVariables(
  sql: string
): { sql: string; placeholders: string[] } {
  const templateRegex = /{{[^}]+}}/g;
  const placeholders: string[] = [];
  const sqlWithoutTemplates = sql.replace(templateRegex, (match) => {
    placeholders.push(match);
    return `__TEMPLATE_${placeholders.length - 1}__`;
  });
  return { sql: sqlWithoutTemplates, placeholders };
}

function restoreTemplateVariables(sql: string, placeholders: string[]): string {
  return sql.replace(
    /__TEMPLATE_(\d+)__/g,
    (_, index) => placeholders[parseInt(index)]
  );
}

export function useFormatter(datasourceType?: DataSourceType) {
  const [state, setState] = useState<FormattingState>({
    error: null,
    originalSql: null,
    formattedSql: null,
  });

  const formatSql = useCallback(
    (sql: string): string => {
      try {
        // Clear any previous errors
        setState((prev) => ({ ...prev, error: null }));

        // If we're in formatted state, return to original
        if (state.originalSql) {
          setState({
            error: null,
            originalSql: null,
            formattedSql: null,
          });
          return state.originalSql;
        }

        // Format the SQL
        const {
          sql: sqlWithoutTemplates,
          placeholders,
        } = replaceTemplateVariables(sql);
        const formatted = format(sqlWithoutTemplates, {
          language: getSqlFormatterLanguage(datasourceType),
        });
        const result = restoreTemplateVariables(formatted, placeholders);

        // Update state to track formatting
        setState({
          error: null,
          originalSql: sql,
          formattedSql: result,
        });

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to format SQL";
        setState({
          error: errorMessage,
          originalSql: null,
          formattedSql: null,
        });
        return sql; // Return original SQL if formatting fails
      }
    },
    [state.originalSql, datasourceType]
  );

  const handleSqlChange = useCallback(
    (newSql: string) => {
      // Clear formatting state if user makes manual changes
      if (
        state.originalSql &&
        newSql !== state.originalSql &&
        newSql !== state.formattedSql
      ) {
        setState({
          error: null,
          originalSql: null,
          formattedSql: null,
        });
      }
    },
    [state.originalSql, state.formattedSql]
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    formatSql,
    handleSqlChange,
    clearError,
    isFormatted: !!state.originalSql,
    error: state.error,
  };
}
