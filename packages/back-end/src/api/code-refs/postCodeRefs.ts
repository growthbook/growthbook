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
import { promiseAllChunks } from "back-end/src/util/promise";

export const postCodeRefs = createApiRequestHandler(postCodeRefsValidator)(
  async (req): Promise<PostCodeRefsResponse> => {
    const { deleteMissing: deleteMissingString } = req.query;
    const { branch, repoName: repo } = req.body;
    const refsByFeature = groupBy(req.body.refs, "flagKey");
    // convert deleteMissing to boolean
    const deleteMissing = deleteMissingString === "true";
    const allExistingCodeRefs: FeatureCodeRefsInterface[] =
      await getAllCodeRefsForOrg({
        context: req.context,
      });

    const existingCodeRefsForRepoBranch = allExistingCodeRefs.filter(
      (codeRef) => codeRef.repo === repo && codeRef.branch === branch,
    );

    const existingFeatures = [
      ...new Set(
        existingCodeRefsForRepoBranch.map((codeRef) => codeRef.feature),
      ),
    ];

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
  },
);
