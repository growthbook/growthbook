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
import {
  EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE_SUFFIX,
  EVENT_FORWARDER_FEATURE_USAGE_TABLE_SUFFIX,
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
  resolveLegacyEventForwarderManagedSourceAttribute,
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
  /** Column alias / join key — the identifier type name, which users may rename. */
  userIdType: string;
  /** SDK attribute the value is read from. Defaults to the identifier type name. */
  sourceAttribute?: string;
  attributeDatatype?: SDKAttributeType;
}): string {
  // The column alias / join key is the identifier type name, but the value is
  // always extracted from the linked source attribute, so renaming an identifier
  // type changes only the alias.
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
      // Left empty so the model layer mints a stable `exq_` id. The id is
      // referenced by experiments, reports, and safe rollouts, so it must never
      // be derived from the identifier type name — see
      // reconcileEventForwarderManagedExposureQueries, which preserves it.
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

/**
 * The SDK attribute a managed query reads. For queries written before the link
 * existed the attribute is recovered from the legacy `ef_`-prefixed identifier
 * name, so reconciliation matches them to their attribute and preserves their id
 * instead of dropping them and minting a replacement.
 */
function getEventForwarderExposureQuerySourceAttribute(
  query: ExposureQuery,
): string {
  const linked = query.sourceAttribute ?? null;
  if (linked !== null) {
    return linked;
  }
  if (isEventForwarderManagedExposureQuery(query)) {
    return resolveLegacyEventForwarderManagedSourceAttribute(query.userIdType);
  }
  return query.userIdType;
}

/**
 * Compares two exposure queries for sameness. Whitespace-insensitive so that
 * reformatting alone does not read as a different query; otherwise exact.
 */
function isEquivalentExposureQuerySql(a: string, b: string): boolean {
  const normalize = (sql: string) => sql.trim().replace(/\s+/g, " ");
  return normalize(a) === normalize(b);
}

/**
 * Reconciles managed exposure queries against the datasource's Event Forwarder
 * linked identifier types, matching on `sourceAttribute`.
 *
 * Ownership split: GrowthBook owns `userIdType`, `name`, `sourceAttribute`, and
 * `query` (all regenerated here, so renaming an identifier type rewrites the
 * column alias automatically). The user owns `dimensions`, `hasNameCol`, and the
 * dimension metadata, which are carried over untouched. The `id` is always
 * preserved — experiments, reports, and safe rollouts reference it.
 *
 * Non-managed queries pass through untouched. Managed queries whose source
 * attribute is no longer represented are dropped.
 */
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
  const desired = generateEventForwarderExposureQueries(
    userIdTypes,
    params,
    attributeSchema,
  );
  const desiredBySource = new Map(
    desired.map((query) => [
      normalizeUserIdTypeName(
        getEventForwarderExposureQuerySourceAttribute(query),
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

    const source = normalizeUserIdTypeName(
      getEventForwarderExposureQuerySourceAttribute(query),
    );
    const wanted = desiredBySource.get(source);
    if (!wanted) {
      continue;
    }

    claimedSources.add(source);
    result.push({
      ...query,
      userIdType: wanted.userIdType,
      name: wanted.name,
      sourceAttribute: wanted.sourceAttribute,
      description: wanted.description,
      query: wanted.query,
    });
  }

  for (const [source, wanted] of desiredBySource) {
    if (claimedSources.has(source)) {
      continue;
    }

    // The user may already have written this exact query against a reused
    // identifier type. Adding a managed twin would give them two identical
    // assignment queries, so skip. A query that merely shares the identifier but
    // differs in SQL is left alone and the managed one is added alongside it.
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
