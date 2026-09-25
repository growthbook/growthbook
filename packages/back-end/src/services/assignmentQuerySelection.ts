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
  hasAssignmentQuerySelectionChanged,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";

/**
 * Validates `next` only when it differs from `previous` (always when `previous`
 * is null), so a record whose query later drifted can still save unrelated
 * edits. A missing data source or query id is left for analysis to surface.
 */
export async function assertValidAssignmentQuerySelectionChange(
  context: ReqContext | ApiReqContext,
  previous: AssignmentQuerySelection | null,
  next: AssignmentQuerySelection,
): Promise<void> {
  if (!next.datasource || !next.exposureQueryId) return;
  let datasource: Promise<DataSourceInterface | null> | undefined;
  const loadDatasource = () =>
    (datasource ??= context.dangerouslyGetDataSourceByIdBypassPermission(
      next.datasource,
    ));
  const loadExposureQueries = async () =>
    (await loadDatasource())?.settings.queries?.exposure ?? [];
  if (
    previous &&
    !(await hasAssignmentQuerySelectionChanged(
      previous,
      next,
      loadExposureQueries,
    ))
  ) {
    return;
  }
  const loaded = await loadDatasource();
  if (!loaded) return;
  assertValidAssignmentQuerySelection({
    exposureQueries: loaded.settings.queries?.exposure ?? [],
    exposureQueryId: next.exposureQueryId,
    identifierType: next.identifierType,
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
