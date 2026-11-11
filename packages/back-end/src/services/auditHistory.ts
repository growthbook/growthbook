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

// Read-filtered getters: each returns null for an entity the user can't read.
const readableEntityGetters: Partial<
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
  population: (context, id) => context.models.populations.getById(id),
  savedGroup: (context, id) => context.models.savedGroups.getById(id),
  constant: (context, id) => context.models.constants.getById(id),
  config: (context, id) => context.models.configs.getById(id),
  customHook: (context, id) => context.models.customHooks.getById(id),
  contextualBandit: (context, id) =>
    context.models.contextualBandits.getById(id),
  interleaving: (context, id) => context.models.interleavings.getById(id),
};

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

  const getReadable = id ? readableEntityGetters[type] : undefined;
  if (id && getReadable && (await getReadable(context, id))) return [];

  // Deleted, unreadable, unscoped or type-wide history needs the org-level audit permission.
  if (!permissions.canViewAuditLogs()) {
    permissions.throwPermissionError();
  }
  return [];
}
