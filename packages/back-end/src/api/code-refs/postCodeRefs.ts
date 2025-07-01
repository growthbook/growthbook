import { groupBy, values } from "lodash";
import { PostCodeRefsResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postCodeRefsValidator } from "back-end/src/validators/openapi";
import {
  getFeatureCodeRefsByFeatures,
  upsertFeatureCodeRefs,
  getAllCodeRefsForOrg,
} from "back-end/src/models/FeatureCodeRefs";
import { FeatureCodeRefsInterface } from "back-end/types/code-refs";

export const postCodeRefs = createApiRequestHandler(postCodeRefsValidator)(
  async (req): Promise<PostCodeRefsResponse> => {
    const { branch, repoName: repo } = req.body;
    const refsByFeature = groupBy(req.body.refs, "flagKey");

    const allExistingCodeRefs: FeatureCodeRefsInterface[] = await getAllCodeRefsForOrg(
      {
        context: req.context,
      }
    );

    const existingCodeRefsForRepoBranch = allExistingCodeRefs.filter(
      (codeRef) => codeRef.repo === repo && codeRef.branch === branch
    );

    const existingFeatures = new Array(
      ...existingCodeRefsForRepoBranch.map((codeRef) => codeRef.feature)
    );

    const requestedFeatures = new Set(Object.keys(refsByFeature));

    const featuresToRemove = existingFeatures.filter(
      (feature) => !requestedFeatures.has(feature)
    );

    // Remove references for features not in the request by setting empty refs
    await Promise.all(
      featuresToRemove.map(async (feature) => {
        await upsertFeatureCodeRefs({
          feature,
          repo,
          branch,
          codeRefs: [], // Empty array will replace all existing refs
          organization: req.context.org,
        });
      })
    );

    // Update references for features in the request
    await Promise.all(
      values(refsByFeature).map(async (refs) => {
        await upsertFeatureCodeRefs({
          feature: refs[0].flagKey,
          repo,
          branch,
          codeRefs: refs,
          organization: req.context.org,
        });
      })
    );

    // Get all features that were updated (both added/updated and removed)
    const allAffectedFeatures = [...requestedFeatures, ...featuresToRemove];

    return {
      featuresUpdated: (
        await getFeatureCodeRefsByFeatures({
          repo,
          branch,
          features: allAffectedFeatures,
          organization: req.context.org,
        })
      ).map((f) => f.feature),
    };
  }
);
