import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { getFeatureRevisionsByFeaturesCurrentVersion } from "back-end/src/models/FeatureRevisionModel";
import { ListFeaturesResponse } from "back-end/types/openapi";
import { getAllPayloadExperiments } from "back-end/src/models/ExperimentModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import {
  getApiFeatureObj,
  getSavedGroupMap,
  getFeatureDefinitions,
} from "back-end/src/services/features";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { listFeaturesValidator } from "back-end/src/validators/openapi";
import { findSDKConnectionByKey } from "back-end/src/models/SdkConnectionModel";

export const listFeatures = createApiRequestHandler(listFeaturesValidator)(
  async (req): Promise<ListFeaturesResponse> => {
    const features = await getAllFeatures(req.context, {
      projects: req.query.projectId ? [req.query.projectId] : undefined,
      includeArchived: true,
    });
    const groupMap = await getSavedGroupMap(req.organization);
    const experimentMap = await getAllPayloadExperiments(
      req.context,
      req.query.projectId ? [req.query.projectId] : undefined,
    );

    // If SDK clientKey is provided, get the SDK connection and use its projects/environment
    let filteredFeatures = features;
    if (req.query.clientKey) {
      const sdkConnection = await findSDKConnectionByKey(req.query.clientKey);
      if (
        !sdkConnection ||
        sdkConnection.organization !== req.organization.id
      ) {
        throw new Error("Invalid SDK connection key");
      }

      const payload = await getFeatureDefinitions({
        context: req.context,
        capabilities: getConnectionSDKCapabilities(sdkConnection),
        environment: sdkConnection.environment,
        projects: sdkConnection.projects,
        includeVisualExperiments: sdkConnection.includeVisualExperiments,
        includeDraftExperiments: sdkConnection.includeDraftExperiments,
        includeExperimentNames: sdkConnection.includeExperimentNames,
        includeRedirectExperiments: sdkConnection.includeRedirectExperiments,
        savedGroupReferencesEnabled: sdkConnection.savedGroupReferencesEnabled,
        dateUpdated: sdkConnection.payloadUpdated,
      });

      filteredFeatures = features.filter(
        (feature) => feature.id in payload.features,
      );
    }

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      filteredFeatures.sort(
        (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime(),
      ),
      req.query,
    );

    //get all feature ids and there version
    const revisions = await getFeatureRevisionsByFeaturesCurrentVersion(
      req.context,
      filtered,
    );
    const safeRolloutMap =
      await req.context.models.safeRollout.getAllPayloadSafeRollouts();

    return {
      features: filtered.map((feature) => {
        const revision =
          revisions?.find(
            (r) => r.featureId === feature.id && r.version === feature.version,
          ) || null;
        return getApiFeatureObj({
          feature,
          organization: req.organization,
          groupMap,
          experimentMap,
          revision,
          safeRolloutMap,
        });
      }),
      ...returnFields,
    };
  },
);
