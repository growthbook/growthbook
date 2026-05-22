import { format } from "shared/sql";
import { AlterNewIncrementalUnitsQueryParams } from "shared/types/integrations";
import { SqlDialect } from "shared/types/sql";

export function getAlterNewIncrementalUnitsQuery(
  dialect: SqlDialect,
  params: AlterNewIncrementalUnitsQueryParams,
): string {
  // BigQuery requires the rename target to be a bare table name and resolves
  // it within the source table's dataset. Most other engines (Snowflake,
  // Postgres, etc.) resolve a bare target against the session's current
  // schema instead — which silently breaks when the connection's default
  // schema is not the pipeline's write schema. Use the fully-qualified target
  // everywhere except BigQuery to remove that footgun.
  const renameTarget =
    dialect.formatDialect === "bigquery"
      ? params.unitsTableName
      : params.unitsTableFullName;
  return format(
    `
      ALTER TABLE ${params.unitsTempTableFullName} RENAME TO ${renameTarget}
      `,
    dialect.formatDialect,
  );
}
