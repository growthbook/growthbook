import { useState, useCallback } from "react";
import { FormatDialect, format } from "shared";
import { DataSourceType } from "back-end/types/datasource";

interface FormattingState {
  error: string | null;
  originalSql: string | null;
  formattedSql: string | null;
}

function getSqlFormatterLanguage(
  datasourceType: DataSourceType
): FormatDialect | undefined {
  const typeMap: Record<DataSourceType, FormatDialect | undefined> = {
    redshift: "redshift",
    snowflake: "snowflake",
    mysql: "mysql",
    bigquery: "bigquery",
    postgres: "postgresql",
    mssql: "tsql",
    clickhouse: "sql",
    growthbook_clickhouse: "sql",
    athena: "trino",
    presto: "trino",
    databricks: "sql",
    vertica: "postgresql",
    mixpanel: undefined, // no formatting for mixpanel
    google_analytics: "bigquery",
  };

  return typeMap[datasourceType];
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

export function useSqlFormatter(datasourceType?: DataSourceType) {
  const [state, setState] = useState<FormattingState>({
    error: null,
    originalSql: null,
    formattedSql: null,
  });

  const formatSql = useCallback(
    (sql: string): string => {
      // If we're in formatted state, return to original
      if (state.originalSql) {
        setState({
          error: null,
          originalSql: null,
          formattedSql: null,
        });
        return state.originalSql;
      }

      if (!datasourceType) return sql;

      const dialect = getSqlFormatterLanguage(datasourceType);
      if (!dialect) return sql;

      try {
        // Format the SQL - using shared format function
        const {
          sql: sqlWithoutTemplates,
          placeholders,
        } = replaceTemplateVariables(sql);

        const formatted = format(sqlWithoutTemplates, dialect);

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
