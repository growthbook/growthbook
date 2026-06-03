import type { ExposureQuery } from "shared/types/datasource";
import {
  buildBigQueryEventForwarderTableReference,
  buildEventForwarderNestedAttributeValueSql,
  buildSnowflakeEventForwarderTableReference,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
} from "./event-forwarder-fact-table";
import { normalizeSnowflakeTableNameForEventForwarder } from "./snowflake-table-name";

export const EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE = "experiment_viewed";

function quoteBigQueryIdentifier(identifier: string): string {
  return `\`${identifier}\``;
}

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
    normalizeSnowflakeTableNameForEventForwarder(
      EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE,
    ),
  );
}

export function buildEventForwarderAttributeValueSql({
  sinkType,
  userIdType,
}: {
  sinkType: "bigquery" | "snowflake";
  userIdType: string;
}): string {
  return buildEventForwarderNestedAttributeValueSql({
    sinkType,
    attributeName: userIdType,
    castToString: true,
  });
}

export function buildEventForwarderExposureQuerySql({
  sinkType,
  tableRef,
  userIdType,
}: {
  sinkType: "bigquery" | "snowflake";
  tableRef: string;
  userIdType: string;
}): string {
  const attributeValueSql = buildEventForwarderAttributeValueSql({
    sinkType,
    userIdType,
  });

  if (sinkType === "bigquery") {
    const quotedId = quoteBigQueryIdentifier(userIdType);
    return `SELECT
  ${attributeValueSql} AS ${quotedId},
  timestamp AS timestamp,
  experiment_id AS experiment_id,
  variation_id AS variation_id
FROM ${tableRef}
WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`;
  }

  return `SELECT
  ${attributeValueSql} AS ${userIdType},
  TIMESTAMP AS timestamp,
  EXPERIMENT_ID AS experiment_id,
  VARIATION_ID AS variation_id
FROM ${tableRef}`;
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
      userIdType,
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
