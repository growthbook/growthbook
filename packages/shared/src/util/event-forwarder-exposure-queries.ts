import type { ExposureQuery } from "shared/types/datasource";
import type {
  SDKAttribute,
  SDKAttributeSchema,
  SDKAttributeType,
} from "shared/types/organization";
import {
  buildBigQueryEventForwarderTableReference,
  buildEventForwarderNestedAttributeValueSql,
  buildSnowflakeEventForwarderTableReference,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  quoteBigQueryIdentifier,
} from "./event-forwarder-fact-table";
import { normalizeSnowflakeTableNameForEventForwarder } from "./snowflake-table-name";

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
    normalizeSnowflakeTableNameForEventForwarder(
      EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE,
    ),
  );
}

function findHashAttributeForUserIdType(
  userIdType: string,
  attributeSchema?: SDKAttributeSchema,
): SDKAttribute | undefined {
  const normalized = userIdType.toLowerCase();
  return attributeSchema?.find(
    (attribute) =>
      attribute.hashAttribute &&
      attribute.property.toLowerCase() === normalized,
  );
}

export function buildEventForwarderAttributeValueSql({
  sinkType,
  userIdType,
  attributeDatatype,
}: {
  sinkType: "bigquery" | "snowflake";
  userIdType: string;
  attributeDatatype?: SDKAttributeType;
}): string {
  if (attributeDatatype !== undefined) {
    return buildEventForwarderNestedAttributeValueSql({
      sinkType,
      attributeName: userIdType,
      attributeDatatype,
    });
  }

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
  attributeDatatype,
}: {
  sinkType: "bigquery" | "snowflake";
  tableRef: string;
  userIdType: string;
  attributeDatatype?: SDKAttributeType;
}): string {
  const attributeValueSql = buildEventForwarderAttributeValueSql({
    sinkType,
    userIdType,
    attributeDatatype,
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
  attributeSchema?: SDKAttributeSchema,
): ExposureQuery[] {
  const tableRef = buildEventForwarderExperimentViewedTableReference(params);

  return userIdTypes.map((userIdType) => {
    const attribute = findHashAttributeForUserIdType(
      userIdType,
      attributeSchema,
    );

    return {
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
        attributeDatatype: attribute?.datatype,
      }),
    };
  });
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
  attributeSchema?: SDKAttributeSchema,
): ExposureQuery[] {
  const missing = userIdTypes.filter(
    (userIdType) => !exposureQueryExistsForUserIdType(existing, userIdType),
  );

  if (missing.length === 0) {
    return existing;
  }

  return [
    ...existing,
    ...generateEventForwarderExposureQueries(missing, params, attributeSchema),
  ];
}

export function refreshEventForwarderManagedExposureQuery(
  existing: ExposureQuery[],
  matchUserIdType: string,
  attribute: SDKAttribute,
  params: GenerateEventForwarderExposureQueriesParams,
): ExposureQuery[] {
  const normalized = matchUserIdType.toLowerCase();
  const tableRef = buildEventForwarderExperimentViewedTableReference(params);
  let found = false;

  const updated = existing.map((query) => {
    if (
      !isEventForwarderManagedExposureQuery(query) ||
      query.userIdType.toLowerCase() !== normalized
    ) {
      return query;
    }

    found = true;
    const userIdType = attribute.property;

    return {
      ...query,
      id: userIdType,
      userIdType,
      name: userIdType,
      query: buildEventForwarderExposureQuerySql({
        sinkType: params.sinkType,
        tableRef,
        userIdType,
        attributeDatatype: attribute.datatype,
      }),
    };
  });

  return found ? updated : existing;
}

export function reconcileEventForwarderManagedExposureQueries({
  existing,
  userIdTypes,
  params,
  attributeSchema,
  managedExposureQueryIds = [],
}: {
  existing: ExposureQuery[];
  userIdTypes: string[];
  params: GenerateEventForwarderExposureQueriesParams;
  attributeSchema?: SDKAttributeSchema;
  managedExposureQueryIds?: string[];
}): ExposureQuery[] {
  const managedIds = new Set(managedExposureQueryIds);
  const desiredManaged = generateEventForwarderExposureQueries(
    userIdTypes,
    params,
    attributeSchema,
  );

  return [
    ...existing.filter(
      (query) =>
        !isEventForwarderManagedExposureQuery(query) &&
        !managedIds.has(query.id),
    ),
    ...desiredManaged,
  ];
}
