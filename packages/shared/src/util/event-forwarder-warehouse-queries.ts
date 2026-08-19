import type {
  ExposureQuery,
  FeatureUsageQuery,
  UserIdType,
} from "shared/types/datasource";
import type {
  SDKAttribute,
  SDKAttributeSchema,
  SDKAttributeType,
} from "shared/types/organization";
import { attributeDataTypes } from "../constants";
import {
  resolveBigQueryEventForwarderTableNames,
  resolveSnowflakeEventForwarderTableNames,
} from "./event-forwarder-destination";
import {
  buildBigQueryEventForwarderTableReference,
  buildEventForwarderNestedAttributeValueSql,
  buildEventForwarderPropertyValueSql,
  buildSnowflakeEventForwarderTableReference,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  quoteBigQueryIdentifier,
} from "./event-forwarder-fact-table";
import {
  getEventForwarderUserIdTypeSourceAttribute,
  normalizeUserIdTypeName,
  releaseEventForwarderManagedRecord,
} from "./event-forwarder-datasource";

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

function buildEventForwarderSinkTableReference(
  params: BuildEventForwarderExperimentViewedTableRefParams,
  table: "experimentViewed" | "featureUsage",
): string {
  if (params.sinkType === "bigquery") {
    const tableNames = resolveBigQueryEventForwarderTableNames(
      params.tablePrefix,
    );
    return buildBigQueryEventForwarderTableReference(
      params.projectId,
      params.dataset,
      tableNames[table],
    );
  }

  const tableNames = resolveSnowflakeEventForwarderTableNames(
    params.tablePrefix,
  );
  return buildSnowflakeEventForwarderTableReference(
    params.database,
    params.schema,
    tableNames[table],
  );
}

export function buildEventForwarderExperimentViewedTableReference(
  params: BuildEventForwarderExperimentViewedTableRefParams,
): string {
  return buildEventForwarderSinkTableReference(params, "experimentViewed");
}

export function buildEventForwarderFeatureUsageTableReference(
  params: BuildEventForwarderFeatureUsageTableRefParams,
): string {
  return buildEventForwarderSinkTableReference(params, "featureUsage");
}

function findHashAttributeBySourceAttribute(
  sourceAttribute: string,
  attributeSchema?: SDKAttributeSchema,
): SDKAttribute | undefined {
  const normalized = normalizeUserIdTypeName(sourceAttribute);
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
  sourceAttribute,
  attributeDatatype,
}: {
  sinkType: "bigquery" | "snowflake";
  tableRef: string;
  userIdType: string;
  sourceAttribute?: string;
  attributeDatatype?: SDKAttributeType;
}): string {
  // Alias (userIdType) ≠ extraction key (sourceAttribute).
  const attributeValueSql = buildEventForwarderAttributeValueSql({
    sinkType,
    userIdType: sourceAttribute ?? userIdType,
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
  userIdTypes: UserIdType[],
  params: GenerateEventForwarderExposureQueriesParams,
  attributeSchema?: SDKAttributeSchema,
): ExposureQuery[] {
  const tableRef = buildEventForwarderExperimentViewedTableReference(params);

  return userIdTypes.map((userIdType) => {
    const sourceAttribute =
      getEventForwarderUserIdTypeSourceAttribute(userIdType);
    const attribute = findHashAttributeBySourceAttribute(
      sourceAttribute,
      attributeSchema,
    );

    return {
      // Empty id → model mints stable exq_; reconcile preserves it.
      id: "",
      userIdType: userIdType.userIdType,
      name: userIdType.userIdType,
      sourceAttribute,
      description: EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
      dimensions: [],
      managedBy: "api" as const,
      query: buildEventForwarderExposureQuerySql({
        sinkType: params.sinkType,
        tableRef,
        userIdType: userIdType.userIdType,
        sourceAttribute,
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

// Backfill source from owning identifier type when missing.
function getEventForwarderExposureQuerySourceAttribute(
  query: ExposureQuery,
  userIdTypesByName: Map<string, UserIdType>,
): string {
  const linked = query.sourceAttribute ?? null;
  if (linked !== null) {
    return linked;
  }
  const owner = userIdTypesByName.get(
    normalizeUserIdTypeName(query.userIdType),
  );
  if (owner) {
    return getEventForwarderUserIdTypeSourceAttribute(owner);
  }
  return query.userIdType;
}

function isEquivalentExposureQuerySql(a: string, b: string): boolean {
  const normalize = (sql: string) => sql.trim().replace(/\s+/g, " ");
  return normalize(a) === normalize(b);
}

// True if SQL matches any generated datatype variant (pre-modal edits).
function isUnmodifiedManagedExposureQuerySql({
  query,
  sinkType,
  tableRef,
  sourceAttribute,
}: {
  query: ExposureQuery;
  sinkType: "bigquery" | "snowflake";
  tableRef: string;
  sourceAttribute: string;
}): boolean {
  const candidateDatatypes: (SDKAttributeType | undefined)[] = [
    undefined,
    ...attributeDataTypes,
  ];
  return candidateDatatypes.some((attributeDatatype) =>
    isEquivalentExposureQuerySql(
      query.query,
      buildEventForwarderExposureQuerySql({
        sinkType,
        tableRef,
        userIdType: query.userIdType,
        sourceAttribute,
        attributeDatatype,
      }),
    ),
  );
}

function releaseManagedExposureQuery(query: ExposureQuery): ExposureQuery {
  return releaseEventForwarderManagedRecord(
    query,
    EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
  );
}

export function reconcileEventForwarderManagedExposureQueries({
  existing,
  userIdTypes,
  params,
  attributeSchema,
}: {
  existing: ExposureQuery[];
  userIdTypes: UserIdType[];
  params: GenerateEventForwarderExposureQueriesParams;
  attributeSchema?: SDKAttributeSchema;
}): ExposureQuery[] {
  const tableRef = buildEventForwarderExperimentViewedTableReference(params);
  const desired = generateEventForwarderExposureQueries(
    userIdTypes,
    params,
    attributeSchema,
  );
  const userIdTypesByName = new Map(
    userIdTypes.map((userIdType) => [
      normalizeUserIdTypeName(userIdType.userIdType),
      userIdType,
    ]),
  );
  const desiredBySource = new Map(
    desired.map((query) => [
      normalizeUserIdTypeName(
        getEventForwarderExposureQuerySourceAttribute(query, userIdTypesByName),
      ),
      query,
    ]),
  );
  const claimedSources = new Set<string>();
  const result: ExposureQuery[] = [];

  for (const query of existing) {
    if (!isEventForwarderManagedExposureQuery(query)) {
      result.push(query);
      continue;
    }

    const sourceAttribute = getEventForwarderExposureQuerySourceAttribute(
      query,
      userIdTypesByName,
    );
    const source = normalizeUserIdTypeName(sourceAttribute);
    if (!desiredBySource.has(source)) {
      result.push(releaseManagedExposureQuery(query));
      continue;
    }

    if (
      !isUnmodifiedManagedExposureQuerySql({
        query,
        sinkType: params.sinkType,
        tableRef,
        sourceAttribute,
      })
    ) {
      // Leave source unclaimed so a fresh managed query is generated.
      result.push(releaseManagedExposureQuery(query));
      continue;
    }

    claimedSources.add(source);
    const attribute = findHashAttributeBySourceAttribute(
      sourceAttribute,
      attributeSchema,
    );
    result.push({
      ...query,
      sourceAttribute: query.sourceAttribute ?? sourceAttribute,
      query: buildEventForwarderExposureQuerySql({
        sinkType: params.sinkType,
        tableRef,
        userIdType: query.userIdType,
        sourceAttribute,
        attributeDatatype: attribute?.datatype,
      }),
    });
  }

  for (const [source, wanted] of desiredBySource) {
    if (claimedSources.has(source)) {
      continue;
    }

    // Skip a managed twin when a user query already has equivalent SQL.
    const duplicatesUserQuery = existing.some(
      (query) =>
        !isEventForwarderManagedExposureQuery(query) &&
        normalizeUserIdTypeName(query.userIdType) ===
          normalizeUserIdTypeName(wanted.userIdType) &&
        isEquivalentExposureQuerySql(query.query, wanted.query),
    );
    if (duplicatesUserQuery) {
      continue;
    }

    result.push(wanted);
  }

  return result;
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
  feature_key AS feature_key,
  environment AS environment,
  ${buildEventForwarderPropertyValueSql({ sinkType, propertyKey: "value" })} AS value,
  ${buildEventForwarderPropertyValueSql({ sinkType, propertyKey: "source" })} AS source,
  ${buildEventForwarderPropertyValueSql({ sinkType, propertyKey: "ruleId" })} AS rule_id,
  ${buildEventForwarderPropertyValueSql({ sinkType, propertyKey: "variationId" })} AS variation_id
FROM ${tableRef}
WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`;
  }

  return `SELECT
  TIMESTAMP AS timestamp,
  FEATURE_KEY AS feature_key,
  ENVIRONMENT AS environment,
  ${buildEventForwarderPropertyValueSql({ sinkType, propertyKey: "value" })} AS value,
  ${buildEventForwarderPropertyValueSql({ sinkType, propertyKey: "source" })} AS source,
  ${buildEventForwarderPropertyValueSql({ sinkType, propertyKey: "ruleId" })} AS rule_id,
  ${buildEventForwarderPropertyValueSql({ sinkType, propertyKey: "variationId" })} AS variation_id
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
