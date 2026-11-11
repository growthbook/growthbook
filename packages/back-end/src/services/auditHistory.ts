import { isFactMetricId } from "shared/experiments";
import type { EntityType } from "shared/types/audit";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getMetricById } from "back-end/src/models/MetricModel";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  canReadApiKeyHistory,
  getApiKeyIdsHiddenFromKeyViewers,
} from "back-end/src/services/apiKeyHistory";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

type Context = ReqContext | ApiReqContext;
type SetElement<S> = S extends Set<infer T> ? T : never;

// BaseModels whose `context.models.<type>s.getById` gates history reads.
const READABLE_BASE_MODEL_TYPES = new Set([
  "population",
  "savedGroup",
  "constant",
  "config",
  "customHook",
  "contextualBandit",
  "interleaving",
] as const);

function isReadableBaseModelType(
  type: EntityType,
): type is SetElement<typeof READABLE_BASE_MODEL_TYPES> {
  return (READABLE_BASE_MODEL_TYPES as ReadonlySet<EntityType>).has(type);
}

const legacyEntityGetters: Partial<
  Record<EntityType, (context: Context, id: string) => Promise<unknown>>
> = {
  feature: getFeature,
  experiment: getExperimentById,
  metric: (context, id) =>
    isFactMetricId(id)
      ? context.models.factMetrics.getById(id)
      : getMetricById(context, id),
  factTable: getFactTable,
  datasource: getDataSourceById,
};

// Read-filtered getters: each returns null for an entity the user can't read.
function getReadableEntity(context: Context, type: EntityType, id: string) {
  if (isReadableBaseModelType(type)) {
    return context.models[`${type}s` as const].getById(id);
  }
  return legacyEntityGetters[type]?.(context, id) ?? null;
}

// Throws unless the user may read this audit history; returns entity ids to leave out of it.
export async function getAuditHistoryExcludeIds(
  context: Context,
  type: EntityType,
  id: string | undefined,
): Promise<string[]> {
  const { permissions } = context;

  if (type === "apiKey") {
    if (!(await canReadApiKeyHistory(context, id))) {
      permissions.throwPermissionError();
    }
    // Members' tokens share the apiKey log, so leave them out unless the user manages them.
    return !id && !permissions.canManagePersonalAccessTokens()
      ? getApiKeyIdsHiddenFromKeyViewers(context)
      : [];
  }

  if (type === "project") {
    if (id && !permissions.canReadSingleProjectResource(id)) {
      permissions.throwPermissionError();
    }
    // Leave out Projects the user can't read; deleted ones stay visible.
    return id
      ? []
      : (await context.getAllProjectIds()).filter(
          (p) => !permissions.canReadSingleProjectResource(p),
        );
  }

  if (id && (await getReadableEntity(context, type, id))) return [];

  // Deleted, unreadable, unscoped or type-wide history needs the org-level audit permission.
  if (!permissions.canViewAuditLogs()) {
    permissions.throwPermissionError();
  }
  return [];
}
