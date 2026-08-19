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
} from "./event-forwarder-datasource";

export const EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE =
  EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE_SUFFIX;
export const EVENT_FORWARDER_FEATURE_USAGE_TABLE =
  EVENT_FORWARDER_FEATURE_USAGE_TABLE_SUFFIX;
export const EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION =
  "Managed by Event Forwarder and updated when the linked Identifier type changes.";
export const EVENT_FORWARDER_MANAGED_FEATURE_USAGE_QUERY_DESCRIPTION =
  "Managed by Event Forwarder for feature usage events.";
export const EVENT_FORWARDER_RELEASED_QUERY_DESCRIPTION = "Managed by User";

/**
 * Swaps the Event Forwarder's own description for the released one when handing
 * a query over. A description the user wrote is theirs and is left as it is —
 * only the generated text, which would otherwise keep promising updates that no
 * longer happen, is replaced.
 */
export function releaseEventForwarderQueryDescription(
  description: string | undefined,
  managedDescription: string,
): string | undefined {
  return description === managedDescription
    ? EVENT_FORWARDER_RELEASED_QUERY_DESCRIPTION
    : description;
}

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
  /** Column alias / join key — the identifier type's own name. */
  userIdType: string;
  /** SDK attribute the value is read from. Defaults to the identifier type name. */
  sourceAttribute?: string;
  attributeDatatype?: SDKAttributeType;
}): string {
  // The alias and the source are decoupled: a legacy `ef_user_id` identifier
  // type keeps that alias while reading the `user_id` attribute.
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
 * The SDK attribute a query reads. Queries written before the link existed carry
 * it nowhere, so it comes from the identifier type they run against — which by
 * then has been matched to its attribute. That is what lets a query provisioned
 * under the old naming keep its id instead of being replaced.
 */
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

/**
 * Compares two exposure queries for sameness. Whitespace-insensitive so that
 * reformatting alone does not read as a different query; otherwise exact.
 */
function isEquivalentExposureQuerySql(a: string, b: string): boolean {
  const normalize = (sql: string) => sql.trim().replace(/\s+/g, " ");
  return normalize(a) === normalize(b);
}

/**
 * Whether a managed query still holds generator output rather than a human's
 * edit. For a fixed alias and source attribute the only thing that varies is
 * the datatype cast, so every variant is a candidate.
 *
 * This matters for data written before the edit modal cleared `managedBy`: it
 * used to do so only when the identifier type changed, so a query whose SQL
 * alone was edited kept `managedBy: "api"` and would be regenerated over.
 */
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

/**
 * Drops the managed marker and the link, keeping the id, name, and SQL exactly
 * as stored. Reconciliation never deletes an exposure query — its id is what
 * experiments, reports, safe rollouts, templates, and ramp schedules reference.
 */
function releaseManagedExposureQuery(query: ExposureQuery): ExposureQuery {
  const released: ExposureQuery = {
    ...query,
    managedBy: "",
    description: releaseEventForwarderQueryDescription(
      query.description,
      EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
    ),
  };
  delete released.sourceAttribute;
  return released;
}

/**
 * Reconciles managed exposure queries against the datasource's Event Forwarder
 * linked identifier types, matching on `sourceAttribute` so each attribute ends
 * up with exactly one managed query.
 *
 * A query that already covers its attribute keeps its `id`, `name`, and
 * `userIdType`; `sourceAttribute` is backfilled when missing. Its SQL is
 * regenerated so the extraction tracks the attribute's current datatype — the
 * alias comes from the query's own `userIdType`, which is never renamed, so the
 * warehouse column stays put and only the cast moves.
 *
 * Editing a managed query in the UI clears `managedBy`, handing it to the user;
 * from then on it passes through untouched and a fresh managed query is added
 * beside it. A query still marked managed whose SQL is not generator output was
 * edited before the modal did that, so it is handed over here instead of being
 * regenerated over.
 *
 * Non-managed queries pass through untouched. A managed query whose source
 * attribute is no longer represented is released, not deleted: the marker and
 * the link come off and it stays as the user's own query.
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
      // Attribute gone. The query is released rather than deleted — its id is
      // referenced by experiments, reports, safe rollouts, templates, and ramp
      // schedules, and deleting it would orphan every one of them.
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
      // Hand-edited. Hand it to the user rather than overwriting, matching what
      // the edit modal does now; the loop below adds a fresh managed query
      // beside it. The source stays unclaimed so that query is generated.
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
        // The query's own alias, not the identifier type's current name: this
        // must not move a warehouse column.
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
