import { format } from "shared/sql";
import { AlterNewIncrementalUnitsQueryParams } from "shared/types/integrations";
import { SqlDialect } from "shared/types/sql";

export function getAlterNewIncrementalUnitsQuery(
  dialect: SqlDialect,
  params: AlterNewIncrementalUnitsQueryParams,
): string {
  // Snowflake requires the rename target to be a fully-qualified table name.
  const renameTarget =
    dialect.formatDialect === "snowflake"
      ? params.unitsTableFullName
      : params.unitsTableName;
  return format(
    `
      ALTER TABLE ${params.unitsTempTableFullName} RENAME TO ${renameTarget}
      `,
    dialect.formatDialect,
  );
}
