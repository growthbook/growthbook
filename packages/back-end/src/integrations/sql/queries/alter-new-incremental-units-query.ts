import { format } from "shared/sql";
import { AlterNewIncrementalUnitsQueryParams } from "shared/types/integrations";
import { SqlDialect } from "shared/types/sql";

export function getAlterNewIncrementalUnitsQuery(
  dialect: SqlDialect,
  params: AlterNewIncrementalUnitsQueryParams,
): string {
  return format(
    `
      ALTER TABLE ${params.unitsTempTableFullName} RENAME TO ${params.unitsTableName}
      `,
    dialect.formatDialect,
  );
}
