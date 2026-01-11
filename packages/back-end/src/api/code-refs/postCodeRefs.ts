import { groupBy, values } from "lodash";
import { PostCodeRefsResponse } from "shared/types/openapi";
import { postCodeRefsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getExistingFeaturesForRepoBranch,
  bulkUpsertFeatureCodeRefs,
  getFeatureKeysForRepoBranch,
} from "back-end/src/models/FeatureCodeRefs";

export const postCodeRefs = createApiRequestHandler(postCodeRefsValidator)(
  async (req): Promise<PostCodeRefsResponse> => {
    const { deleteMissing: deleteMissingString } = req.query;
    const { branch, repoName: repo } = req.body;
    const refsByFeature = groupBy(req.body.refs, "flagKey");
    // convert deleteMissing to boolean
    const deleteMissing = deleteMissingString === "true";

    // Only query for feature names for the specific repo/branch using projection
    const existingFeatures = await getExistingFeaturesForRepoBranch({
      repo,
      branch,
      organization: req.context.org,
    });

    const requestedFeatures = new Set(Object.keys(refsByFeature));

    let featuresToRemove: string[] = [];

    if (deleteMissing) {
      featuresToRemove = existingFeatures.filter(
        (feature) => !requestedFeatures.has(feature),
      );

      // Remove references for features not in the request by setting empty refs
      if (featuresToRemove.length > 0) {
        await bulkUpsertFeatureCodeRefs({
          repo,
          branch,
          updates: featuresToRemove.map((feature) => ({
            feature,
            codeRefs: [], // Empty array will replace all existing refs
          })),
          organization: req.context.org,
        });
      }
    }

    // Update references for features in the request using bulk operation
    const updates = values(refsByFeature).map((refs) => ({
      feature: refs[0].flagKey,
      codeRefs: refs,
    }));

    if (updates.length > 0) {
      await bulkUpsertFeatureCodeRefs({
        repo,
        branch,
        updates,
        organization: req.context.org,
      });
    }

    // Get all features that were updated (both added/updated and removed)
    const allAffectedFeatures = [...requestedFeatures, ...featuresToRemove];

    // Only fetch feature keys, not the full documents with all refs
    const featuresUpdated = await getFeatureKeysForRepoBranch({
      repo,
      branch,
      features: allAffectedFeatures,
      organization: req.context.org,
    });

    return {
      featuresUpdated,
    };
  },
);
