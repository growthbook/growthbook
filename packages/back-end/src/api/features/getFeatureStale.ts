import {
  getFeatureStaleValidator,
  ACTIVE_DRAFT_STATUSES,
} from "shared/validators";
import { GetFeatureStaleResponse } from "shared/types/openapi";
import { isFeatureStale } from "shared/util";
import { getFeature, getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";

export const getFeatureStale = createApiRequestHandler(
  getFeatureStaleValidator,
)(async (req): Promise<GetFeatureStaleResponse> => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }

  const neverStale = feature.neverStale ?? false;
  const computedAt = new Date().toISOString();

  // Short-circuit: no computation or env data when detection is disabled
  if (neverStale) {
    return {
      featureId: feature.id,
      isStale: false,
      staleReason: "never-stale",
      staleLastCalculated: computedAt,
      neverStale: true,
    };
  }

  const [allFeatures, allExperiments, draftRevisions] = await Promise.all([
    getAllFeatures(req.context, {}),
    getAllExperiments(req.context, { includeArchived: false }),
    getRevisionsByStatus(
      req.context as ReqContext,
      [...ACTIVE_DRAFT_STATUSES],
      { sparse: true },
    ),
  ]);

  const mostRecentDraftDate = draftRevisions
    .filter((r) => r.featureId === feature.id)
    .reduce<Date | null>((max, r) => {
      const d = new Date(r.dateUpdated ?? 0);
      return !max || d > max ? d : max;
    }, null);

  const applicableEnvIds = getEnvironments(req.context.org)
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

  type PublicEnvReason = NonNullable<
    GetFeatureStaleResponse["staleByEnv"]
  >[string];

  const staleByEnv: NonNullable<GetFeatureStaleResponse["staleByEnv"]> =
    Object.fromEntries(
      Object.entries(envResults).map(([envId, r]) => [
        envId,
        {
          isStale: r.stale,
          // "error" and "never-stale" are internal; omit from public env reasons
          reason: (r.reason === "error" || r.reason === "never-stale"
            ? null
            : (r.reason ?? null)) as PublicEnvReason extends { reason: infer R }
            ? R
            : never,
          ...(r.evaluatesTo !== undefined
            ? { evaluatesTo: r.evaluatesTo }
            : {}),
        } as NonNullable<PublicEnvReason>,
      ]),
    );

  // "error" is not a public reason; map to null
  const publicReason = reason === "error" ? null : (reason ?? null);

  return {
    featureId: feature.id,
    isStale: stale,
    staleReason: publicReason as GetFeatureStaleResponse["staleReason"],
    staleLastCalculated: computedAt,
    neverStale: false,
    ...(Object.keys(staleByEnv).length > 0 ? { staleByEnv } : {}),
  };
});
