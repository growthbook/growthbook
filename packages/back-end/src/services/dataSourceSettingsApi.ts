import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import {
  DataSourceInterface,
  DataSourceSettings,
  ExposureQuery,
  IdentityJoinQuery,
  UserIdType,
} from "shared/types/datasource";
import { PutDataSourceSettingsBody } from "shared/validators";
import {
  getExposureQueryIdentifierTypes,
  getExposureQueryTimestampColumn,
  isManagedWarehouseUnavailable,
} from "shared/util";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  testIdentityJoinQueryValidity,
  testQueryValidity,
} from "back-end/src/services/datasource";

type SentAssignmentQuery = NonNullable<
  PutDataSourceSettingsBody["assignmentQueries"]
>[number];

export type MergedDataSourceSettings = {
  settings: DataSourceSettings;
  changed: boolean;
  /** Added or changed assignment queries, as they'd be saved. */
  changedExposureQueries: ExposureQuery[];
  /** Join queries not already stored exactly as sent. */
  newIdentityJoins: IdentityJoinQuery[];
};

export function findRepeatedAssignmentQueryId(
  queries: { id: string }[] = [],
): string | null {
  const seen = new Set<string>();
  for (const { id } of queries) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

function mergeIdentifierTypes(
  stored: UserIdType[],
  sent: NonNullable<PutDataSourceSettingsBody["identifierTypes"]>,
): UserIdType[] {
  return sent.map(({ id, description }) => {
    const existing = stored.find((t) => t.userIdType === id);
    if (!existing) {
      return { userIdType: id, description: description ?? "" };
    }
    return description === undefined ||
      description === (existing.description || "")
      ? existing
      : { ...existing, description };
  });
}

// Each field is compared with what the GET shows for the stored query, so
// echoing a GET back writes nothing. Returns `stored` when nothing changes.
function mergeAssignmentQuery(
  stored: ExposureQuery,
  sent: SentAssignmentQuery,
): ExposureQuery {
  const updates: Partial<ExposureQuery> = {};
  if (sent.name !== stored.name) updates.name = sent.name;
  if (
    sent.description !== undefined &&
    sent.description !== (stored.description || "")
  ) {
    updates.description = sent.description;
  }
  if (!isEqual(sent.identifierTypes, getExposureQueryIdentifierTypes(stored))) {
    updates.userIdTypes = sent.identifierTypes;
  }
  if (sent.sql !== stored.query) updates.query = sent.sql;
  if (
    sent.includesNameColumns !== undefined &&
    sent.includesNameColumns !== !!stored.hasNameCol
  ) {
    updates.hasNameCol = sent.includesNameColumns;
  }
  if (
    sent.dimensionColumns !== undefined &&
    !isEqual(sent.dimensionColumns, stored.dimensions ?? [])
  ) {
    updates.dimensions = sent.dimensionColumns;
  }
  if (
    sent.projects !== undefined &&
    !isEqual(sent.projects, stored.projects ?? [])
  ) {
    updates.projects = sent.projects;
  }
  if (
    sent.columnMapping !== undefined &&
    !isEqual(sent.columnMapping, stored.columnMapping ?? {})
  ) {
    updates.columnMapping = sent.columnMapping;
  }
  if (!Object.keys(updates).length) return stored;
  // A changed query is tested before it's saved, so its old error goes
  return { ...omit(stored, "error"), ...updates };
}

function newAssignmentQuery(
  sent: SentAssignmentQuery,
  id: string,
): ExposureQuery {
  return {
    id,
    name: sent.name,
    description: sent.description ?? "",
    userIdType: sent.identifierTypes[0],
    userIdTypes: sent.identifierTypes,
    query: sent.sql,
    hasNameCol: !!sent.includesNameColumns,
    dimensions: sent.dimensionColumns ?? [],
    ...(sent.projects?.length ? { projects: sent.projects } : {}),
    ...(sent.columnMapping ? { columnMapping: sent.columnMapping } : {}),
  };
}

/**
 * Applies a `PUT /data-sources/:id/settings` body to the stored settings.
 * Identifier types and join queries replace the stored lists. Assignment
 * queries are added or updated by id, and stored ones not sent are kept. If
 * several stored queries share an id, only the first is updated. Pass
 * `generateId` to give added assignment queries a server id.
 */
export function mergeDataSourceSettingsBody(
  stored: DataSourceSettings,
  body: PutDataSourceSettingsBody,
  generateId?: () => string,
): MergedDataSourceSettings {
  const settings: DataSourceSettings = { ...stored };
  let changed = false;

  if (body.identifierTypes) {
    const storedTypes = stored.userIdTypes ?? [];
    const next = mergeIdentifierTypes(storedTypes, body.identifierTypes);
    if (!isEqual(next, storedTypes)) {
      settings.userIdTypes = next;
      changed = true;
    }
  }

  let newIdentityJoins: IdentityJoinQuery[] = [];
  if (body.identifierJoinQueries) {
    const storedJoins = stored.queries?.identityJoins ?? [];
    const next = body.identifierJoinQueries.map((j) => ({
      ids: j.identifierTypes,
      query: j.sql,
    }));
    const storedAsSent = storedJoins.map((j) => ({
      ids: j.ids,
      query: j.query,
    }));
    if (!isEqual(next, storedAsSent)) {
      settings.queries = { ...settings.queries, identityJoins: next };
      changed = true;
      newIdentityJoins = next.filter(
        (j) => !storedAsSent.some((s) => isEqual(s, j)),
      );
    }
  }

  const changedExposureQueries: ExposureQuery[] = [];
  if (body.assignmentQueries) {
    const storedQueries = stored.queries?.exposure ?? [];
    const next = [...storedQueries];
    for (const sent of body.assignmentQueries) {
      const index = storedQueries.findIndex((q) => q.id === sent.id);
      if (index === -1) {
        const query = newAssignmentQuery(
          sent,
          generateId ? generateId() : sent.id,
        );
        next.push(query);
        changedExposureQueries.push(query);
        continue;
      }
      const merged = mergeAssignmentQuery(storedQueries[index], sent);
      if (merged !== storedQueries[index]) {
        next[index] = merged;
        changedExposureQueries.push(merged);
      }
    }
    if (changedExposureQueries.length) {
      settings.queries = { ...settings.queries, exposure: next };
      changed = true;
    }
  }

  return { settings, changed, changedExposureQueries, newIdentityJoins };
}

const TEST_FAILED_MESSAGE =
  "Nothing was saved because these queries failed their test.";

function assignmentQueryLine(query: ExposureQuery, error: string) {
  return `Assignment query "${query.id}": ${error}`;
}

function identityJoinLine(join: IdentityJoinQuery, error: string) {
  return `Identifier join query for ${join.ids.join(", ")}: ${error}`;
}

/**
 * Tests added and changed queries against the warehouse, reading no rows.
 * Every SQL template is compiled before any query runs. Returns the refusal
 * message, or null when every query passed or the data source can't test.
 */
export async function testDataSourceSettingsQueries(
  integration: SourceIntegrationInterface,
  datasource: Pick<DataSourceInterface, "type" | "settings">,
  {
    exposureQueries,
    identityJoins,
    testDays,
  }: {
    exposureQueries: ExposureQuery[];
    identityJoins: IdentityJoinQuery[];
    testDays?: number;
  },
): Promise<string | null> {
  const { getTestValidityQuery } = integration;
  if (!getTestValidityQuery || !integration.runTestQuery) return null;
  // Matches the dashboard's save, which can't test while the Managed
  // Warehouse's tables aren't there
  if (isManagedWarehouseUnavailable(datasource)) return null;

  const compileErrors: string[] = [];
  for (const query of exposureQueries) {
    try {
      getTestValidityQuery.call(
        integration,
        query.query,
        testDays,
        undefined,
        getExposureQueryTimestampColumn(query),
      );
    } catch (e) {
      compileErrors.push(assignmentQueryLine(query, e.message));
    }
  }
  for (const join of identityJoins) {
    try {
      getTestValidityQuery.call(integration, join.query, testDays);
    } catch (e) {
      compileErrors.push(identityJoinLine(join, e.message));
    }
  }
  if (compileErrors.length) {
    return [TEST_FAILED_MESSAGE, ...compileErrors].join("\n");
  }

  const results = await Promise.all([
    ...exposureQueries.map(async (query) => {
      const error = await testQueryValidity(integration, query, testDays);
      return error ? assignmentQueryLine(query, error) : null;
    }),
    ...identityJoins.map(async (join) => {
      const error = await testIdentityJoinQueryValidity(
        integration,
        join,
        testDays,
      );
      return error ? identityJoinLine(join, error) : null;
    }),
  ]);
  const failures = results.filter((line): line is string => !!line);
  return failures.length ? [TEST_FAILED_MESSAGE, ...failures].join("\n") : null;
}
