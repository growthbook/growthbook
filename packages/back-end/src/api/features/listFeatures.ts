import {
  getFeatureRevisionsByFeaturesCurrentVersion,
  getFeatureRevisionsByFeaturesDraftVersion,
} from "../../models/FeatureRevisionModel";
import { ListFeaturesResponse } from "../../../types/openapi";
import { getAllPayloadExperiments } from "../../models/ExperimentModel";
import { getAllFeatures } from "../../models/FeatureModel";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listFeaturesValidator } from "../../validators/openapi";

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
      filtered
    );
    const draftRevisions = await getFeatureRevisionsByFeaturesDraftVersion(
      filtered
    );

    return {
      features: filtered.map((feature) => {
        const revision =
          revisions?.find(
            (r) => r.featureId === feature.id && r.version === feature.version
          ) || null;
        const draftRevision =
          draftRevisions?.find(
            (r) => r.featureId === feature.id && r.status === "draft"
          ) || null;
        return getApiFeatureObj({
          feature,
          organization: req.organization,
          groupMap,
          experimentMap,
          revision,
          draftRevision,
        });
      }),
      ...returnFields,
    };
  }
);
