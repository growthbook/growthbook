import type { ExposureQuery, FeatureUsageQuery } from "shared/types/datasource";
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
  EventForwarderUserIdTypePair,
  isEventForwarderManaged,
  normalizeUserIdTypeName,
  resolveEventForwarderManagedName,
  toNormalizedNameSet,
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

function isEquivalentExposureQuerySql(a: string, b: string): boolean {
  const normalize = (sql: string) => sql.trim().replace(/\s+/g, " ");
  return normalize(a) === normalize(b);
}

// True for generator output under any datatype cast, so a query written before
// an attribute's datatype changed still counts as unmodified.
function isGeneratedExposureQuerySql({
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

/**
 * Gives every paired identifier type a managed assignment query. A query
 * already carrying generator output is left alone whoever owns it, so a user who
 * wrote the same SQL themselves keeps their own query. Nothing is ever removed,
 * and a managed query keeps its id, name and userIdType for the life of the
 * record — those are referenced by experiments, reports, safe rollouts,
 * templates and ramp schedules.
 */
export function reconcileEventForwarderManagedExposureQueries({
  existing,
  pairs,
  params,
  attributeSchema,
}: {
  existing: ExposureQuery[];
  pairs: EventForwarderUserIdTypePair[];
  params: GenerateEventForwarderExposureQueriesParams;
  attributeSchema?: SDKAttributeSchema;
}): ExposureQuery[] {
  const tableRef = buildEventForwarderExperimentViewedTableReference(params);
  const result = [...existing];
  const takenNames = toNormalizedNameSet(existing.map((query) => query.name));

  for (const { attribute, userIdType } of pairs) {
    const attributeDatatype = findHashAttributeBySourceAttribute(
      attribute,
      attributeSchema,
    )?.datatype;
    const buildSql = (alias: string) =>
      buildEventForwarderExposureQuerySql({
        sinkType: params.sinkType,
        tableRef,
        userIdType: alias,
        sourceAttribute: attribute,
        attributeDatatype,
      });

    const onIdentifier = result
      .map((query, index) => ({ query, index }))
      .filter(
        ({ query }) =>
          normalizeUserIdTypeName(query.userIdType) ===
          normalizeUserIdTypeName(userIdType.userIdType),
      );

    const regenerate = ({
      query,
      index,
    }: {
      query: ExposureQuery;
      index: number;
    }) => {
      result[index] = { ...query, query: buildSql(query.userIdType) };
    };

    const generated = onIdentifier.find(({ query }) =>
      isGeneratedExposureQuerySql({
        query,
        sinkType: params.sinkType,
        tableRef,
        sourceAttribute: attribute,
      }),
    );
    if (generated) {
      if (isEventForwarderManaged(generated.query)) {
        regenerate(generated);
      }
      continue;
    }

    const managed = onIdentifier.find(({ query }) =>
      isEventForwarderManaged(query),
    );
    if (managed) {
      regenerate(managed);
      continue;
    }

    const name = resolveEventForwarderManagedName(
      userIdType.userIdType,
      takenNames,
    );
    takenNames.add(normalizeUserIdTypeName(name));
    result.push({
      // Empty id → the model mints a stable exq_; reconcile preserves it after.
      id: "",
      userIdType: userIdType.userIdType,
      name,
      description: EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
      dimensions: [],
      managedBy: "api",
      query: buildSql(userIdType.userIdType),
    });
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

export function getActiveFeatureUsageQuery(
  queries: FeatureUsageQuery[] | undefined,
): FeatureUsageQuery | undefined {
  if (!queries?.length) {
    return undefined;
  }

  return queries.find(isEventForwarderManaged) ?? queries[0];
}
