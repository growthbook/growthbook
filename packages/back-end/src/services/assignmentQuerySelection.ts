// Assignment query selection checks for models and handlers. Keep this module's
// runtime imports to shared/util: services/datasource pulls in every warehouse
// integration, and models importing it form an import cycle.
import type {
  DataSourceInterface,
  ExposureQuery,
} from "shared/types/datasource";
import type {
  ApiAssignmentQueryRefInput,
  RampMonitoringConfig,
} from "shared/validators";
import {
  apiMonitoringConfigToInternal,
  AssignmentQuerySelection,
  isSameAssignmentQuerySelection,
  parseAssignmentQuerySelection,
  resolveAssignmentQuerySelectionChange,
  toMonitoringSelection,
  withKeptIdentifierType,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";

/**
 * Whether `next` changes `previous` (always when `previous` is null), with the
 * data source to validate it against. The data source is null when there's no
 * data source or query to check; analysis surfaces that instead. Reads the
 * request's data source cache before bypassing read scope, so a selection the
 * caller may edit is checked even when they can't read the data source.
 */
export async function loadChangedAssignmentQuerySelection(
  context: ReqContext | ApiReqContext,
  previous: AssignmentQuerySelection | null,
  next: AssignmentQuerySelection,
): Promise<
  { changed: false } | { changed: true; datasource: DataSourceInterface | null }
> {
  if (previous && isSameAssignmentQuerySelection(previous, next, [])) {
    return { changed: false };
  }
  if (!next.datasource || !next.exposureQueryId) {
    return { changed: true, datasource: null };
  }
  const datasource =
    context.foreignRefs.datasource.get(next.datasource) ??
    (await context.dangerouslyGetDataSourceByIdBypassPermission(
      next.datasource,
    ));
  if (!datasource) return { changed: true, datasource: null };
  if (
    previous &&
    isSameAssignmentQuerySelection(
      previous,
      next,
      datasource.settings.queries?.exposure ?? [],
    )
  ) {
    return { changed: false };
  }
  return { changed: true, datasource };
}

/**
 * Runs resolveAssignmentQuerySelectionChange against the data source of `next`,
 * loaded as in loadChangedAssignmentQuerySelection, and throws on an invalid
 * change. With no data source or query to check, the kept identifier passes
 * through unvalidated.
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
  const selection = await loadChangedAssignmentQuerySelection(
    context,
    previous,
    kept,
  );
  if (!selection.changed) {
    return {
      identifierType: previous?.identifierType || undefined,
      changed: false,
    };
  }
  if (!selection.datasource) {
    return { identifierType: kept.identifierType, changed: false };
  }
  const result = resolveAssignmentQuerySelectionChange(
    selection.datasource.settings.queries?.exposure ?? [],
    { previous, next: kept, onOmitted, field },
  );
  if (!result.ok) throw new Error(result.error);
  return result;
}

/**
 * Only a changed selection is validated, so a record whose query later drifted
 * can still save unrelated edits.
 */
export async function assertValidAssignmentQuerySelectionChange(
  context: ReqContext | ApiReqContext,
  previous: AssignmentQuerySelection | null,
  next: AssignmentQuerySelection,
): Promise<void> {
  const selection = await loadChangedAssignmentQuerySelection(
    context,
    previous,
    next,
  );
  if (!selection.changed || !selection.datasource) return;
  const parsed = parseAssignmentQuerySelection(
    selection.datasource.settings.queries?.exposure ?? [],
    {
      exposureQueryId: next.exposureQueryId,
      identifierType: next.identifierType,
      onOmitted: "defaultToFirst",
    },
  );
  if (!parsed.ok) throw new Error(parsed.error);
}

/**
 * The data source's exposure queries, for resolving legacy records'
 * identifiers. Reads the request's data source cache, so serializing a list
 * loads data sources once.
 */
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

/**
 * Converts a REST monitoring config to the stored flat shape. A new or changed
 * selection gets the identifier it resolves to; an unchanged one keeps the
 * stored identifier. The config is replaced whole, so an implicit selection
 * omits the key rather than persisting an undefined.
 */
export async function resolveApiMonitoringConfig<
  T extends {
    datasourceId: string;
    exposureQuery?: ApiAssignmentQueryRefInput;
    exposureQueryId?: string;
  },
>(
  context: ReqContext | ApiReqContext,
  mc: T,
  previous: RampMonitoringConfig | null | undefined,
) {
  const { exposureQueryIdentifierType, ...rest } =
    apiMonitoringConfigToInternal(mc, previous);
  const { identifierType } = await resolveAssignmentQueryIdentifier(context, {
    previous: previous ? toMonitoringSelection(previous) : null,
    next: {
      datasource: rest.datasourceId,
      exposureQueryId: rest.exposureQueryId,
      identifierType: exposureQueryIdentifierType,
    },
    onOmitted: "requireUnambiguous",
    field: "exposureQuery",
  });
  return identifierType === undefined
    ? rest
    : { ...rest, exposureQueryIdentifierType: identifierType };
}
