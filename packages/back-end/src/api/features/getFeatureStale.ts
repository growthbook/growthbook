import {
  getFeatureStaleValidator,
  ACTIVE_DRAFT_STATUSES,
  FeatureStaleEntry,
} from "shared/validators";
import {
  getApplicableEnvIds,
  isFeatureStale,
  TempRolloutStaleReason,
} from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { buildFeatureLookups } from "back-end/src/util/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { yieldEventLoop } from "back-end/src/util/yield";
import { ReqContext } from "back-end/types/request";
import { loadStaleGraph } from "back-end/src/services/featureStaleGraph";

export async function computeFeatureStale(
  context: ApiReqContext,
  query: { ids: string },
) {
  const ids = query.ids
    .split(",")
    .map((id) => decodeURIComponent(id.trim()))
    .filter(Boolean);

  if (!ids.length) {
    return { features: {} };
  }

  const [
    { features: allFeatures, experiments: allExperiments },
    requestedFeatures,
    draftRevisions,
  ] = await Promise.all([
    // The verdict reports the values the requested features evaluate to,
    // so those load in full.
    loadStaleGraph(context, ids),
    getAllFeaturesWithoutEditorFields(context, { ids, includeArchived: true }),
    getRevisionsByStatus(context as ReqContext, [...ACTIVE_DRAFT_STATUSES], {
      sparse: true,
      featureIds: ids,
    }),
  ]);

  const features = requestedFeatures.filter((f) => !f.archived);

  const lookups = buildFeatureLookups(allFeatures, allExperiments);

  const result: Record<string, FeatureStaleEntry> = {};
  const orgEnvs = getEnvironments(context.org);

  for (let i = 0; i < features.length; i++) {
    await yieldEventLoop(i);
    const feature = features[i];

    if (feature.neverStale) {
      result[feature.id] = {
        featureId: feature.id,
        isStale: false,
        staleReason: "never-stale",
        neverStale: true,
      };
      continue;
    }

    const mostRecentDraftDate = draftRevisions
      .filter((r) => r.featureId === feature.id)
      .reduce<Date | null>((max, r) => {
        const d = new Date(r.dateUpdated ?? 0);
        return !max || d > max ? d : max;
      }, null);

    const applicableEnvIds = getApplicableEnvIds(orgEnvs, feature);

    const { stale, reason, envResults } = isFeatureStale({
      feature,
      features: allFeatures,
      environments: applicableEnvIds,
      ...lookups,
      mostRecentDraftDate,
    });

    type EnvReason = Exclude<FeatureStaleEntry["staleReason"], "never-stale">;

    const staleByEnv: Record<
      string,
      {
        isStale: boolean;
        reason: EnvReason;
        evaluatesTo?: string;
        tempRollout?: TempRolloutStaleReason;
      }
    > = {};
    for (const [envId, r] of Object.entries(envResults)) {
      staleByEnv[envId] = {
        isStale: r.stale,
        reason: (r.reason === "error" || r.reason === "never-stale"
          ? null
          : (r.reason ?? null)) as EnvReason,
        ...(r.evaluatesTo !== undefined ? { evaluatesTo: r.evaluatesTo } : {}),
        ...(r.tempRollout ? { tempRollout: r.tempRollout } : {}),
      };
    }

    const publicReason = reason === "error" ? null : (reason ?? null);

    result[feature.id] = {
      featureId: feature.id,
      isStale: stale,
      staleReason: publicReason as FeatureStaleEntry["staleReason"],
      neverStale: false,
      ...(Object.keys(staleByEnv).length > 0 ? { staleByEnv } : {}),
    };
  }

  return { features: result };
}

export const getFeatureStale = createApiRequestHandler(
  getFeatureStaleValidator,
)(async (req) => computeFeatureStale(req.context, req.query));
