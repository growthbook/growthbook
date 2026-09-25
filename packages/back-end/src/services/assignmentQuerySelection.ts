// Assignment query selection checks for models and handlers. Keep this module's
// runtime imports to shared/util: services/datasource pulls in every warehouse
// integration, and models importing it form an import cycle.
import type {
  DataSourceInterface,
  ExposureQuery,
} from "shared/types/datasource";
import {
  AssignmentQuerySelection,
  assertAssignmentQueryRefIdentifierType,
  assertValidAssignmentQuerySelection,
  isSameAssignmentQuerySelection,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";

type AssignmentQueryScope = {
  project: string | undefined;
  projects?: string[];
};

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

// Only a changed selection is validated, so a record whose query later drifted
// can still save unrelated edits.
export async function assertValidAssignmentQuerySelectionChange(
  context: ReqContext | ApiReqContext,
  previous: AssignmentQuerySelection | null,
  next: AssignmentQuerySelection,
  getScope: () => AssignmentQueryScope | Promise<AssignmentQueryScope>,
): Promise<void> {
  const datasource = await loadChangedAssignmentQuerySelection(
    context,
    previous,
    next,
  );
  if (!datasource) return;
  assertValidAssignmentQuerySelection({
    exposureQueries: datasource.settings.queries?.exposure ?? [],
    exposureQueryId: next.exposureQueryId,
    identifierType: next.identifierType,
    datasourceProjects: datasource.projects,
    ...(await getScope()),
  });
}

// For REST handlers that haven't loaded the data source's queries yet.
export async function assertApiAssignmentQueryRefHasIdentifierType(
  context: ReqContext | ApiReqContext,
  {
    datasourceId,
    ref,
    field,
    currentExposureQueryId,
  }: {
    datasourceId: string | undefined;
    ref: { id: string; identifierType?: string } | undefined;
    field: "assignmentQuery" | "exposureQuery";
    currentExposureQueryId: string | undefined;
  },
): Promise<void> {
  if (!datasourceId || !ref || ref.identifierType) return;
  if (ref.id === currentExposureQueryId) return;
  assertAssignmentQueryRefIdentifierType({
    ref,
    field,
    exposureQueries: await getExposureQueriesForDatasource(
      context,
      datasourceId,
    ),
    currentExposureQueryId,
  });
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
