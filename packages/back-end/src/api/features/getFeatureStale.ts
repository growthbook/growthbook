import {
  getFeatureStaleValidator,
  ACTIVE_DRAFT_STATUSES,
  FeatureStaleEntry,
} from "shared/validators";
import { isFeatureStale } from "shared/util";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";

export const getFeatureStale = createApiRequestHandler(
  getFeatureStaleValidator,
)(async (req) => {
  const ids = req.query.ids
    .split(",")
    .map((id) => decodeURIComponent(id.trim()))
    .filter(Boolean);

  if (!ids.length) {
    return { features: {} };
  }

  const idSet = new Set(ids);
  const [allFeatures, allExperiments, draftRevisions] = await Promise.all([
    getAllFeatures(req.context, {}),
    getAllExperiments(req.context, { includeArchived: false }),
    getRevisionsByStatus(
      req.context as ReqContext,
      [...ACTIVE_DRAFT_STATUSES],
      { sparse: true },
    ),
  ]);

  const features = allFeatures.filter((f) => idSet.has(f.id));

  const result: Record<string, FeatureStaleEntry> = {};
  const orgEnvs = getEnvironments(req.context.org);

  for (const feature of features) {
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

    const applicableEnvIds = orgEnvs
      .filter(
        (env) =>
          !feature.project ||
          !env.projects?.length ||
          env.projects.includes(feature.project as string),
      )
      .map((env) => env.id);

    const { stale, reason, envResults } = isFeatureStale({
      feature,
      features: allFeatures,
      experiments: allExperiments as unknown as Parameters<
        typeof isFeatureStale
      >[0]["experiments"],
      environments: applicableEnvIds,
      mostRecentDraftDate,
    });

    type EnvReason = Exclude<FeatureStaleEntry["staleReason"], "never-stale">;

    const staleByEnv: Record<
      string,
      { isStale: boolean; reason: EnvReason; evaluatesTo?: string }
    > = {};
    for (const [envId, r] of Object.entries(envResults)) {
      staleByEnv[envId] = {
        isStale: r.stale,
        reason: (r.reason === "error" || r.reason === "never-stale"
          ? null
          : (r.reason ?? null)) as EnvReason,
        ...(r.evaluatesTo !== undefined ? { evaluatesTo: r.evaluatesTo } : {}),
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
});
