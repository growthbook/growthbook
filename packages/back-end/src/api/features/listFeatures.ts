import { getFeatureRevisionsByFeaturesCurrentVersion } from "back-end/src/models/FeatureRevisionModel";
import { ListFeaturesResponse } from "back-end/types/openapi";
import { getAllPayloadExperiments } from "back-end/src/models/ExperimentModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { listFeaturesValidator } from "back-end/src/validators/openapi";

export const listFeatures = createApiRequestHandler(listFeaturesValidator)(
  async (req): Promise<ListFeaturesResponse> => {
    const features = await getAllFeatures(req.context, {
      project: req.query.projectId,
      includeArchived: true,
    });
    const groupMap = await getSavedGroupMap(req.organization);
    const experimentMap = await getAllPayloadExperiments(
      req.context,
      req.query.projectId
    );

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      features.sort(
        (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()
      ),
      req.query
    );
    //get all feature ids and there version
    const revisions = await getFeatureRevisionsByFeaturesCurrentVersion(
      req.context,
      filtered
    );

    return {
      features: await Promise.all(
        filtered.map(async (feature) => {
          const revision =
            revisions?.find(
              (r) => r.featureId === feature.id && r.version === feature.version
            ) || null;
          const apiFeature = await getApiFeatureObj({
            feature,
            context: req.context,
            organization: req.organization,
            groupMap,
            experimentMap,
            revision,
          });
          return apiFeature;
        })
      ),
      ...returnFields,
    };
  }
);
