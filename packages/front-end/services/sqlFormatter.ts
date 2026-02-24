import { DataSourceType } from "shared/types/datasource";
import { format, setPolyglotLoader, startPolyglotLoad } from "shared/sql";
import { FormatDialect } from "shared/types/sql";

let polyglotInitDone = false;
function initPolyglot(): void {
  if (polyglotInitDone) return;
  polyglotInitDone = true;
  setPolyglotLoader(() => import("@polyglot-sql/sdk"));
}

/** Preload polyglot when a Format-capable modal opens so first Format can use it */
export function preloadPolyglot(): void {
  initPolyglot();
  startPolyglotLoad();
}

export function canFormatSql(datasourceType: DataSourceType): boolean {
  return !!getSqlDialect(datasourceType);
}

function getSqlDialect(datasourceType: DataSourceType): FormatDialect | "" {
  const typeMap: Record<DataSourceType, FormatDialect | ""> = {
    redshift: "redshift",
    snowflake: "snowflake",
    mysql: "mysql",
    bigquery: "bigquery",
    postgres: "postgresql",
    mssql: "tsql",
    clickhouse: "",
    growthbook_clickhouse: "",
    athena: "trino",
    presto: "trino",
    databricks: "sql",
    vertica: "postgresql",
    mixpanel: "",
    google_analytics: "",
  };

  return typeMap[datasourceType];
}

// The formatter doesn't support template variables, so we need to replace them with placeholders
function replaceTemplateVariables(sql: string): {
  sql: string;
  placeholders: string[];
} {
  const templateRegex = /{{[^}]+}}/g;
  const placeholders: string[] = [];
  const sqlWithoutTemplates = sql.replace(templateRegex, (match) => {
    placeholders.push(match);
    return `__TEMPLATE_${placeholders.length - 1}__`;
  });
  return { sql: sqlWithoutTemplates, placeholders };
}

// Restore the template variables after formatting
function restoreTemplateVariables(sql: string, placeholders: string[]): string {
  return sql.replace(
    /__TEMPLATE_(\d+)__/g,
    (_, index) => placeholders[parseInt(index)],
  );
}

export function formatSql(
  sql: string,
  datasourceType?: DataSourceType,
): { formattedSql: string | null; error: string | null } {
  if (!datasourceType) {
    return { formattedSql: null, error: "No datasource type provided" };
  }

  const dialect = getSqlDialect(datasourceType);
  if (!dialect) {
    return {
      formattedSql: null,
      error: "Formatting not supported for this datasource type",
    };
  }

  // Lazy-init polyglot loader (Webpack creates async chunk)
  initPolyglot();

  // Format the SQL - using shared format function
  const { sql: sqlWithoutTemplates, placeholders } =
    replaceTemplateVariables(sql);

  let formatError: string | null = null;
  const formatted = format(sqlWithoutTemplates, dialect, ({ error }) => {
    formatError = error.message;
  });

  if (formatError || !formatted) {
    return { formattedSql: null, error: formatError || "Failed to format SQL" };
  }

  const result = restoreTemplateVariables(formatted, placeholders);
  return { formattedSql: result, error: null };
}
