// Assignment query selection checks for models and handlers. Keep this module's
// runtime imports to shared/util: services/datasource pulls in every warehouse
// integration, and models importing it form an import cycle.
import type {
  DataSourceInterface,
  ExposureQuery,
} from "shared/types/datasource";
import {
  AssignmentQuerySelection,
  isSameAssignmentQuerySelection,
  parseAssignmentQuerySelection,
  resolveAssignmentQuerySelectionChange,
  withKeptIdentifierType,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";

/**
 * The data source to validate `next` against when it differs from `previous`
 * (always when `previous` is null), else null. Also null when there's no data
 * source or query to check, which analysis surfaces instead. Reads the
 * request's data source cache before bypassing read scope, so a selection the
 * caller may edit is checked even when they can't read the data source.
 */
export async function loadChangedAssignmentQuerySelection(
  context: ReqContext | ApiReqContext,
  previous: AssignmentQuerySelection | null,
  next: AssignmentQuerySelection,
): Promise<DataSourceInterface | null> {
  if (!next.datasource || !next.exposureQueryId) return null;
  if (previous && isSameAssignmentQuerySelection(previous, next, [])) {
    return null;
  }
  const datasource =
    context.foreignRefs.datasource.get(next.datasource) ??
    (await context.dangerouslyGetDataSourceByIdBypassPermission(
      next.datasource,
    ));
  if (!datasource) return null;
  if (
    previous &&
    isSameAssignmentQuerySelection(
      previous,
      next,
      datasource.settings.queries?.exposure ?? [],
    )
  ) {
    return null;
  }
  return datasource;
}

/**
 * resolveAssignmentQuerySelectionChange against `next`'s data source, loaded per
 * loadChangedAssignmentQuerySelection. Throws on an invalid change. With no data
 * source or query to check, the kept identifier passes unvalidated.
 */
export async function resolveAssignmentQueryIdentifier(
  context: ReqContext | ApiReqContext,
  {
    previous,
    next,
    onOmitted,
    field,
  }: {
    previous: AssignmentQuerySelection | null;
    next: AssignmentQuerySelection;
    onOmitted: "defaultToFirst" | "requireUnambiguous";
    field?: "assignmentQuery" | "exposureQuery";
  },
): Promise<{ identifierType: string | undefined; changed: boolean }> {
  const kept = withKeptIdentifierType(previous, next);
  const datasource = await loadChangedAssignmentQuerySelection(
    context,
    previous,
    kept,
  );
  if (!datasource)
    return { identifierType: kept.identifierType, changed: false };
  const result = resolveAssignmentQuerySelectionChange(
    datasource.settings.queries?.exposure ?? [],
    { previous, next: kept, onOmitted, field },
  );
  if (!result.ok) throw new Error(result.error);
  return result;
}

// Only a changed selection is validated, so a record whose query later drifted
// can still save unrelated edits.
export async function assertValidAssignmentQuerySelectionChange(
  context: ReqContext | ApiReqContext,
  previous: AssignmentQuerySelection | null,
  next: AssignmentQuerySelection,
): Promise<void> {
  const datasource = await loadChangedAssignmentQuerySelection(
    context,
    previous,
    next,
  );
  if (!datasource) return;
  const parsed = parseAssignmentQuerySelection(
    datasource.settings.queries?.exposure ?? [],
    {
      exposureQueryId: next.exposureQueryId,
      identifierType: next.identifierType,
      onOmitted: "defaultToFirst",
    },
  );
  if (!parsed.ok) throw new Error(parsed.error);
}

// Resolves legacy assignment query identifiers from the request's data source
// cache, so serializing a list reads data sources once.
export async function getExposureQueriesForDatasource(
  context: ReqContext | ApiReqContext,
  datasourceId: string,
): Promise<ExposureQuery[]> {
  if (!datasourceId) return [];
  await context.populateForeignRefs({ datasource: [datasourceId] });
  return (
    context.foreignRefs.datasource.get(datasourceId)?.settings?.queries
      ?.exposure ?? []
  );
}
