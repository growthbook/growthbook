/**
 * Identity CTE Builder
 *
 * Pure functions for generating identity join SQL CTEs.
 * Extracted from SqlIntegration.ts for better testability and reuse.
 *
 * Identity CTEs are used to join different user ID types together
 * (e.g., user_id to anonymous_id) when queries need data from tables
 * that use different identifier types.
 */

import { DataSourceSettings } from "shared/types/datasource";
import { getBaseIdTypeAndJoins, compileSqlTemplate } from "back-end/src/util/sql";

/**
 * Interface for SQL generation methods needed by identity CTE builder.
 * This allows the function to be pure while still using dialect-specific SQL.
 */
export interface IdentitiesCTEDialect {
  /**
   * Generate an identity join query between two user ID types.
   * @param settings - Datasource settings with identity join configuration
   * @param id1 - First user ID type (typically the base ID type)
   * @param id2 - Second user ID type to join to
   * @param from - Start date for the query
   * @param to - End date for the query (optional)
   * @param experimentId - Optional experiment ID for template variables
   * @returns SQL query string for the identity join
   */
  getIdentitiesQuery(
    settings: DataSourceSettings,
    id1: string,
    id2: string,
    from: Date,
    to: Date | undefined,
    experimentId?: string
  ): string;
}

/**
 * Parameters for building the identities CTE.
 */
export interface IdentitiesCTEParams {
  /**
   * Arrays of user ID types needed by different objects (metrics, segments, etc.)
   * Each inner array represents the user ID types supported by one object.
   */
  objects: string[][];

  /** Start date for the identity join query */
  from: Date;

  /** End date for the identity join query (optional) */
  to?: Date;

  /**
   * Force a specific base ID type instead of auto-detecting.
   * Useful when the exposure query already determines the user ID type.
   */
  forcedBaseIdType?: string;

  /** Optional experiment ID for template variable substitution */
  experimentId?: string;
}

/**
 * Result of building the identities CTE.
 */
export interface IdentitiesCTEResult {
  /**
   * The base user ID type that all other IDs will be joined to.
   * Either the forced type or the most commonly used type across objects.
   */
  baseIdType: string;

  /**
   * SQL string containing the CTE definitions for identity joins.
   * Format: `__identities_<idtype> as (...), ...`
   */
  idJoinSQL: string;

  /**
   * Map from user ID type to the CTE table name that provides the join.
   * Example: { "anonymous_id": "__identities_anonymous_id" }
   */
  idJoinMap: Record<string, string>;
}

/**
 * Build identity join CTEs for matching different user ID types.
 *
 * When a query needs to join data from multiple sources that use different
 * user ID types (e.g., metrics using user_id and exposures using anonymous_id),
 * this function generates the necessary identity join CTEs.
 *
 * The algorithm:
 * 1. Determine the base ID type (most common or forced)
 * 2. Find which ID types need joins (objects that don't support base type)
 * 3. Generate a CTE for each required join
 *
 * @param dialect - SQL dialect implementation with identity query generation
 * @param settings - Datasource settings with identity join configuration
 * @param params - Parameters including objects, date range, and optional forcing
 * @returns Result with baseIdType, SQL string, and join table mapping
 *
 * @example
 * const result = buildIdentitiesCTE(dialect, settings, {
 *   objects: [
 *     ["user_id"],           // Exposure query uses user_id
 *     ["anonymous_id"],       // Metric uses anonymous_id
 *   ],
 *   from: new Date("2023-01-01"),
 *   to: new Date("2023-01-31"),
 * });
 * // result.baseIdType = "user_id"
 * // result.idJoinMap = { "anonymous_id": "__identities_anonymous_id" }
 * // result.idJoinSQL = "__identities_anonymous_id as (SELECT user_id, anonymous_id FROM ...),"
 */
export function buildIdentitiesCTE(
  dialect: IdentitiesCTEDialect,
  settings: DataSourceSettings,
  params: IdentitiesCTEParams
): IdentitiesCTEResult {
  const { objects, from, to, forcedBaseIdType, experimentId } = params;

  // Determine base ID type and which joins are needed
  const { baseIdType, joinsRequired } = getBaseIdTypeAndJoins(
    objects,
    forcedBaseIdType
  );

  // Build join CTEs for each required ID type
  const joins: string[] = [];
  const idJoinMap: Record<string, string> = {};

  joinsRequired.forEach((idType) => {
    // Sanitize the ID type for use in SQL table names
    const sanitizedIdType = idType.replace(/[^a-zA-Z0-9_]/g, "");
    const table = `__identities_${sanitizedIdType}`;
    idJoinMap[idType] = table;

    // Generate the CTE using the dialect's identity query method
    const identityQuery = dialect.getIdentitiesQuery(
      settings,
      baseIdType,
      idType,
      from,
      to,
      experimentId
    );

    joins.push(
      `${table} as (
        ${identityQuery}
      ),`
    );
  });

  return {
    baseIdType,
    idJoinSQL: joins.join("\n"),
    idJoinMap,
  };
}

/**
 * Generate an identity join query between two user ID types.
 *
 * This is the core logic extracted from SqlIntegration.getIdentitiesQuery.
 * It looks for a matching identity join query in the datasource settings,
 * or falls back to using the pageviews query if available.
 *
 * @param settings - Datasource settings with query configuration
 * @param id1 - First user ID type (typically the base ID type)
 * @param id2 - Second user ID type to join to
 * @param from - Start date for the query
 * @param to - End date for the query (optional)
 * @param experimentId - Optional experiment ID for template variables
 * @param timestampFilter - Function to generate timestamp filter SQL
 * @returns SQL query string for the identity join
 */
export function generateIdentitiesQuery(
  settings: DataSourceSettings,
  id1: string,
  id2: string,
  from: Date,
  to: Date | undefined,
  experimentId: string | undefined,
  timestampFilter: (col: string, from: Date, to: Date | undefined) => string
): string {
  // Check for configured identity join queries
  if (settings?.queries?.identityJoins) {
    for (let i = 0; i < settings.queries.identityJoins.length; i++) {
      const join = settings?.queries?.identityJoins[i];
      if (
        join.query.length > 6 &&
        join.ids.includes(id1) &&
        join.ids.includes(id2)
      ) {
        return `
          SELECT
            ${id1},
            ${id2}
          FROM
            (
              ${compileSqlTemplate(join.query, {
                startDate: from,
                endDate: to,
                experimentId,
              })}
            ) i
          GROUP BY
            ${id1}, ${id2}
          `;
      }
    }
  }

  // Fallback to pageviews query for user_id/anonymous_id joins
  if (settings?.queries?.pageviewsQuery) {
    const timestampColumn = "i.timestamp";

    if (
      ["user_id", "anonymous_id"].includes(id1) &&
      ["user_id", "anonymous_id"].includes(id2)
    ) {
      return `
        SELECT
          user_id,
          anonymous_id
        FROM
          (${compileSqlTemplate(settings.queries.pageviewsQuery, {
            startDate: from,
            endDate: to,
            experimentId,
          })}) i
        WHERE
          ${timestampFilter(timestampColumn, from, to)}
        GROUP BY
          user_id, anonymous_id
        `;
    }
  }

  // If no matching query configuration found, return empty result
  // The original implementation would throw or return incomplete SQL
  throw new Error(
    `No identity join query found for ${id1} and ${id2}. ` +
      `Configure an identity join in your data source settings.`
  );
}
