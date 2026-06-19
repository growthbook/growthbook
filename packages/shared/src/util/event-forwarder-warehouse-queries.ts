import type { ExposureQuery, FeatureUsageQuery } from "shared/types/datasource";
import type {
  SDKAttribute,
  SDKAttributeSchema,
  SDKAttributeType,
} from "shared/types/organization";
import {
  EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE_SUFFIX,
  EVENT_FORWARDER_FEATURE_USAGE_TABLE_SUFFIX,
  resolveBigQueryEventForwarderTableNames,
  resolveSnowflakeEventForwarderTableNames,
} from "./event-forwarder-destination";
import {
  buildBigQueryEventForwarderTableReference,
  buildEventForwarderNestedAttributeValueSql,
  buildSnowflakeEventForwarderTableReference,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  quoteBigQueryIdentifier,
} from "./event-forwarder-fact-table";
import {
  buildEventForwarderManagedIdentifierId,
  getEventForwarderManagedIdentifierSourceAttribute,
} from "./event-forwarder-datasource";

export const EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE =
  EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE_SUFFIX;
export const EVENT_FORWARDER_FEATURE_USAGE_TABLE =
  EVENT_FORWARDER_FEATURE_USAGE_TABLE_SUFFIX;
export const EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION =
  "Managed by Event Forwarder and updated when the linked Identifier type changes.";
export const EVENT_FORWARDER_MANAGED_FEATURE_USAGE_QUERY_DESCRIPTION =
  "Managed by Event Forwarder for feature usage events.";

export type BuildEventForwarderExperimentViewedTableRefParams =
  | {
      sinkType: "bigquery";
      projectId: string;
      dataset: string;
      tablePrefix: string;
    }
  | {
      sinkType: "snowflake";
      database: string;
      schema: string;
      tablePrefix: string;
    };

export type BuildEventForwarderFeatureUsageTableRefParams =
  BuildEventForwarderExperimentViewedTableRefParams;

export function buildEventForwarderExperimentViewedTableReference(
  params: BuildEventForwarderExperimentViewedTableRefParams,
): string {
  if (params.sinkType === "bigquery") {
    const tableNames = resolveBigQueryEventForwarderTableNames(
      params.tablePrefix,
    );
    return buildBigQueryEventForwarderTableReference(
      params.projectId,
      params.dataset,
      tableNames.experimentViewed,
    );
  }

  const tableNames = resolveSnowflakeEventForwarderTableNames(
    params.tablePrefix,
  );
  return buildSnowflakeEventForwarderTableReference(
    params.database,
    params.schema,
    tableNames.experimentViewed,
  );
}

export function buildEventForwarderFeatureUsageTableReference(
  params: BuildEventForwarderFeatureUsageTableRefParams,
): string {
  if (params.sinkType === "bigquery") {
    const tableNames = resolveBigQueryEventForwarderTableNames(
      params.tablePrefix,
    );
    return buildBigQueryEventForwarderTableReference(
      params.projectId,
      params.dataset,
      tableNames.featureUsage,
    );
  }

  const tableNames = resolveSnowflakeEventForwarderTableNames(
    params.tablePrefix,
  );
  return buildSnowflakeEventForwarderTableReference(
    params.database,
    params.schema,
    tableNames.featureUsage,
  );
}

function findHashAttributeForUserIdType(
  userIdType: string,
  attributeSchema?: SDKAttributeSchema,
): SDKAttribute | undefined {
  // userIdType is the managed identifier id (e.g. "ef_user_id"); resolve back to
  // the source attribute before matching the schema.
  const normalized =
    getEventForwarderManagedIdentifierSourceAttribute(userIdType).toLowerCase();
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
  // The column alias / join key is the (prefixed) managed identifier id, but the
  // value is extracted from the real source attribute (e.g. "ef_user_id" reads
  // the "user_id" attribute).
  const sourceAttribute =
    getEventForwarderManagedIdentifierSourceAttribute(userIdType);
  const attributeValueSql = buildEventForwarderAttributeValueSql({
    sinkType,
    userIdType: sourceAttribute,
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

    // userIdType is already the (prefixed) managed identifier id, so the
    // exposure query id/name mirror it directly.
    return {
      id: userIdType,
      userIdType,
      name: userIdType,
      description: EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
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

export function eventForwarderManagedExposureQueryExistsForUserIdType(
  exposureQueries: ExposureQuery[],
  userIdType: string,
): boolean {
  const normalized = userIdType.toLowerCase();
  return exposureQueries.some(
    (q) =>
      isEventForwarderManagedExposureQuery(q) &&
      q.userIdType.toLowerCase() === normalized,
  );
}

export function mergeEventForwarderExposureQueries(
  existing: ExposureQuery[],
  userIdTypes: string[],
  params: GenerateEventForwarderExposureQueriesParams,
  attributeSchema?: SDKAttributeSchema,
): ExposureQuery[] {
  // Only skip identifiers that already have a managed query. A user's own
  // (non-managed) query for the same identifier no longer blocks us, since the
  // prefixed id keeps the managed query from colliding with theirs.
  const missing = userIdTypes.filter(
    (userIdType) =>
      !eventForwarderManagedExposureQueryExistsForUserIdType(
        existing,
        userIdType,
      ),
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
    // Re-derive the managed identifier id from the (possibly renamed) attribute.
    const userIdType = buildEventForwarderManagedIdentifierId(
      attribute.property,
    );

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
}: {
  existing: ExposureQuery[];
  userIdTypes: string[];
  params: GenerateEventForwarderExposureQueriesParams;
  attributeSchema?: SDKAttributeSchema;
}): ExposureQuery[] {
  const desiredManaged = generateEventForwarderExposureQueries(
    userIdTypes,
    params,
    attributeSchema,
  );

  return [
    ...existing.filter((query) => !isEventForwarderManagedExposureQuery(query)),
    ...desiredManaged,
  ];
}

export function buildEventForwarderFeatureUsageQuerySql({
  sinkType,
  tableRef,
}: {
  sinkType: "bigquery" | "snowflake";
  tableRef: string;
}): string {
  if (sinkType === "bigquery") {
    return `SELECT
  timestamp AS timestamp,
  feature_key AS feature_key
FROM ${tableRef}
WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`;
  }

  return `SELECT
  TIMESTAMP AS timestamp,
  FEATURE_KEY AS feature_key
FROM ${tableRef}`;
}

export type GenerateEventForwarderFeatureUsageQueryParams =
  BuildEventForwarderFeatureUsageTableRefParams;

export function buildEventForwarderFeatureUsageQuery(
  params: GenerateEventForwarderFeatureUsageQueryParams,
): Pick<FeatureUsageQuery, "query" | "managedBy" | "description"> {
  const tableRef = buildEventForwarderFeatureUsageTableReference(params);

  return {
    managedBy: "api",
    description: EVENT_FORWARDER_MANAGED_FEATURE_USAGE_QUERY_DESCRIPTION,
    query: buildEventForwarderFeatureUsageQuerySql({
      sinkType: params.sinkType,
      tableRef,
    }),
  };
}

export function isEventForwarderManagedFeatureUsageQuery(
  query: FeatureUsageQuery,
): boolean {
  return query.managedBy === "api";
}

export function getActiveFeatureUsageQuery(
  queries: FeatureUsageQuery[] | undefined,
): FeatureUsageQuery | undefined {
  if (!queries?.length) {
    return undefined;
  }

  return queries.find(isEventForwarderManagedFeatureUsageQuery) ?? queries[0];
}

export function eventForwarderManagedFeatureUsageQueryExists(
  queries: FeatureUsageQuery[],
): boolean {
  return queries.some(isEventForwarderManagedFeatureUsageQuery);
}
