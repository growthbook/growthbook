import { format } from "shared/sql";
import { DropOldIncrementalUnitsQueryParams } from "shared/types/integrations";
import { SqlDialect } from "shared/types/sql";
import { INCREMENTAL_UNITS_TABLE_PREFIX } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";

export function getDropOldIncrementalUnitsQuery(
  dialect: SqlDialect,
  params: DropOldIncrementalUnitsQueryParams,
): string {
  if (!params.unitsTableFullName.includes(INCREMENTAL_UNITS_TABLE_PREFIX)) {
    throw new Error(
      "Unable to drop table that is not an incremental refresh units table.",
    );
  }
  return format(
    `
      DROP TABLE IF EXISTS ${params.unitsTableFullName}
      `,
    dialect.formatDialect,
  );
}
