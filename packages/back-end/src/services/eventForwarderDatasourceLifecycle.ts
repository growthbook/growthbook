import isEqual from "lodash/isEqual";
import { DataSourceInterface } from "shared/types/datasource";
import { usingFileConfig } from "back-end/src/init/config";
import { getDataSourcesByOrganizationSameTypeExcludingId } from "back-end/src/models/DataSourceModel";
import { getEventForwarderSinkTypeForDatasource } from "back-end/src/services/eventForwarderConfig";
import { teardownBigQueryEventForwarderInfrastructure } from "back-end/src/services/eventForwarderProvisioning";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

function mergeProjectsFromDatasources(
  datasources: Pick<DataSourceInterface, "projects">[],
): string[] {
  const merged = new Set<string>();
  for (const ds of datasources) {
    for (const p of ds.projects ?? []) {
      merged.add(p);
    }
  }
  return [...merged].sort();
}

/**
 * After removing a datasource: updates or removes the org event forwarder row when this datasource
 * type maps to a sink (BigQuery / Snowflake / Databricks). Confluent teardown runs only for the
 * BigQuery sink when this was the last datasource of that warehouse type in the org.
 */
export async function syncEventForwarderAfterDatasourceDeleted(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
): Promise<void> {
  if (usingFileConfig()) return;

  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (!sinkType) return;

  const existing =
    await context.models.eventForwarderConfigs.dangerousGetBySinkTypeBypassPermission(
      sinkType,
    );
  if (!existing) return;

  const remaining = await getDataSourcesByOrganizationSameTypeExcludingId(
    context.org.id,
    datasource.id,
    datasource.type,
  );

  if (remaining.length === 0) {
    if (sinkType === "bigquery") {
      await teardownBigQueryEventForwarderInfrastructure(existing);
    }
    await context.models.eventForwarderConfigs.deleteForDatasourceCascade(
      existing,
    );
    return;
  }

  const projects = mergeProjectsFromDatasources(remaining);
  if (isEqual(existing.projects, projects)) {
    return;
  }

  await context.models.eventForwarderConfigs.dangerousUpdateBypassPermission(
    existing,
    { projects },
  );
}
