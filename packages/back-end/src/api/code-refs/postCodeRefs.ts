import lodash from "lodash";
import { PostCodeRefsResponse } from "shared/types/openapi";
import { postCodeRefsValidator } from "shared/validators";
import { promiseAllChunks } from "back-end/src/util/promise";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getExistingFeaturesForRepoBranch,
  getFeatureKeysForRepoBranch,
  upsertFeatureCodeRefs,
} from "back-end/src/models/FeatureCodeRefs";

const { groupBy, values } = lodash;

export const postCodeRefs = createApiRequestHandler(postCodeRefsValidator)(
  async (req): Promise<PostCodeRefsResponse> => {
    const { deleteMissing: deleteMissingString } = req.query;
    const { branch, repoName: repo } = req.body;
    const refsByFeature = groupBy(req.body.refs, "flagKey");
    // convert deleteMissing to boolean
    const deleteMissing = deleteMissingString === "true";

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
      await promiseAllChunks(
        featuresToRemove.map(
          (feature) => async () => {
            await upsertFeatureCodeRefs({
              feature,
              repo,
              branch,
              codeRefs: [], // Empty array will replace all existing refs
              organization: req.context.org,
            });
          },
          5,
        ),
      );
    }

    // Update references for features in the request
    await promiseAllChunks(
      values(refsByFeature).map(
        (refs) => async () => {
          await upsertFeatureCodeRefs({
            feature: refs[0].flagKey,
            repo,
            branch,
            codeRefs: refs,
            organization: req.context.org,
          });
        },
        5,
      ),
    );

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
