import { format } from "shared/sql";
import { AlterNewIncrementalUnitsQueryParams } from "shared/types/integrations";
import { SqlHelpers } from "shared/types/sql";

export function getAlterNewIncrementalUnitsQuery(
  helpers: SqlHelpers,
  params: AlterNewIncrementalUnitsQueryParams,
): string {
  return format(
    `
      ALTER TABLE ${params.unitsTempTableFullName} RENAME TO ${params.unitsTableName}
      `,
    helpers.formatDialect,
  );
}
