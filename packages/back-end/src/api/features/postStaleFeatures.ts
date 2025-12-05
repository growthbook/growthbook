import { isFeatureStale } from "shared/util";
import { PostStaleFeaturesResponse } from "back-end/types/openapi";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { postStaleFeaturesValidator } from "back-end/src/validators/openapi";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllPayloadExperiments } from "back-end/src/models/ExperimentModel";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

export const postStaleFeatures = createApiRequestHandler(
  postStaleFeaturesValidator,
)(async (req): Promise<PostStaleFeaturesResponse> => {
  const { featureIds } = req.body;
  const { projectId } = req.query;

  // Fetch all features (will be filtered by permissions)
  const allFeatures = await getAllFeatures(req.context, {
    projects: projectId ? [projectId] : undefined,
    includeArchived: false,
  });

  // Filter to specific feature IDs if provided
  let featuresToCheck = allFeatures;
  if (featureIds && featureIds.length > 0) {
    const featureIdSet = new Set(featureIds);
    featuresToCheck = allFeatures.filter((f) => featureIdSet.has(f.id));
  }

  // Fetch all experiments for stale checking
  const experimentMap = await getAllPayloadExperiments(
    req.context,
    projectId ? [projectId] : undefined,
  );

  // Convert Map to array for isFeatureStale
  const experiments = Array.from(
    experimentMap.values(),
  ) as unknown as ExperimentInterfaceStringDates[];

  // Get environment IDs from organization settings
  const environments =
    req.organization.settings?.environments?.map((e) => e.id) || [];

  // Check stale status for each feature
  const results = featuresToCheck.map((feature) => {
    const { stale, reason } = isFeatureStale({
      feature,
      features: allFeatures,
      experiments,
      environments,
    });

    return {
      id: feature.id,
      stale,
      ...(reason && { reason }),
    };
  });

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(
    results.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  return {
    features: filtered,
    ...returnFields,
  };
});
