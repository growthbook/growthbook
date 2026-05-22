import type { ExposureQuery } from "shared/types/datasource";
import { EVENT_FORWARDER_AVRO_PARTITION_FIELD } from "../event-forwarder-avro";
import {
  buildBigQueryEventForwarderTableReference,
  buildSnowflakeEventForwarderTableReference,
} from "./event-forwarder-fact-table";

export const EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE = "experiment_viewed";

export type BuildEventForwarderExperimentViewedTableRefParams =
  | {
      sinkType: "bigquery";
      projectId: string;
      dataset: string;
    }
  | {
      sinkType: "snowflake";
      database: string;
      schema: string;
    };

export function buildEventForwarderExperimentViewedTableReference(
  params: BuildEventForwarderExperimentViewedTableRefParams,
): string {
  if (params.sinkType === "bigquery") {
    return buildBigQueryEventForwarderTableReference(
      params.projectId,
      params.dataset,
      EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE,
    );
  }

  return buildSnowflakeEventForwarderTableReference(
    params.database,
    params.schema,
    EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE,
  );
}

export function buildEventForwarderExposureQuerySql({
  sinkType,
  tableRef,
}: {
  sinkType: "bigquery" | "snowflake";
  tableRef: string;
}): string {
  const select = `SELECT
  event_uuid AS id,
  timestamp AS timestamp,
  experiment_id AS experiment_id,
  variation_id AS variation_id
FROM ${tableRef}`;

  if (sinkType === "bigquery") {
    return `${select}
WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`;
  }

  return select;
}

export type GenerateEventForwarderExposureQueriesParams =
  BuildEventForwarderExperimentViewedTableRefParams;

export function generateEventForwarderExposureQueries(
  userIdTypes: string[],
  params: GenerateEventForwarderExposureQueriesParams,
): ExposureQuery[] {
  const tableRef = buildEventForwarderExperimentViewedTableReference(params);

  return userIdTypes.map((userIdType) => ({
    id: userIdType,
    userIdType,
    name: userIdType,
    description: "",
    dimensions: [],
    managedBy: "api" as const,
    query: buildEventForwarderExposureQuerySql({
      sinkType: params.sinkType,
      tableRef,
    }),
  }));
}

export function isEventForwarderManagedExposureQuery(
  query: ExposureQuery,
): boolean {
  return query.managedBy === "api";
}

export function exposureQueryExistsForUserIdType(
  exposureQueries: ExposureQuery[],
  userIdType: string,
): boolean {
  const normalized = userIdType.toLowerCase();
  return exposureQueries.some((q) => q.userIdType.toLowerCase() === normalized);
}

export function mergeEventForwarderExposureQueries(
  existing: ExposureQuery[],
  userIdTypes: string[],
  params: GenerateEventForwarderExposureQueriesParams,
): ExposureQuery[] {
  const missing = userIdTypes.filter(
    (userIdType) => !exposureQueryExistsForUserIdType(existing, userIdType),
  );

  if (missing.length === 0) {
    return existing;
  }

  return [
    ...existing,
    ...generateEventForwarderExposureQueries(missing, params),
  ];
}
