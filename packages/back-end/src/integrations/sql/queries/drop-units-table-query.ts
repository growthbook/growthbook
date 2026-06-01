import { DropTableQueryParams } from "shared/types/integrations";
import {
  UNITS_TABLE_PREFIX,
  ASSIGNMENT_UNITS_TABLE_PREFIX,
} from "back-end/src/queryRunners/ExperimentResultsQueryRunner";

export function getDropUnitsTableQuery(params: DropTableQueryParams): string {
  // validate units table query follows expected name to help
  // prevent dropping other tables
  if (
    !params.fullTablePath.includes(UNITS_TABLE_PREFIX) &&
    !params.fullTablePath.includes(ASSIGNMENT_UNITS_TABLE_PREFIX)
  ) {
    throw new Error("Unable to drop table that is not temporary units table.");
  }
  return `DROP TABLE IF EXISTS ${params.fullTablePath}`;
}
