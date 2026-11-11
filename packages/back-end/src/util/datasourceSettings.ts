import cloneDeep from "lodash/cloneDeep";
import { DataSourceInterface } from "shared/types/datasource";
import { upgradeDatasourceObject } from "back-end/src/util/migrations";
import { logger } from "back-end/src/util/logger";

// Runs the same upgrade every read runs, so settings that would break reads
// are refused on save instead.
export function assertDatasourceSettingsReadable(
  datasource: DataSourceInterface,
): void {
  try {
    upgradeDatasourceObject(cloneDeep(datasource));
  } catch (e) {
    throw new Error(
      `The Data Source was not saved because its settings are malformed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

// Treats a stored data source that can't be upgraded as missing, so one bad
// document doesn't fail every lookup that references it.
export function upgradeReadableDatasources(
  datasources: DataSourceInterface[],
): DataSourceInterface[] {
  return datasources.flatMap((datasource) => {
    try {
      return [upgradeDatasourceObject(datasource)];
    } catch (e) {
      logger.error(
        e,
        `Data Source ${datasource.id} has malformed stored settings and was treated as missing`,
      );
      return [];
    }
  });
}

export function upgradeReadableDatasourcesByIds(
  datasources: DataSourceInterface[],
  ids: string[],
): DataSourceInterface[] {
  return upgradeReadableDatasources(
    datasources.filter((d) => ids.includes(d.id)),
  );
}
