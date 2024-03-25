import { groupBy, values } from "lodash";
import { postCodeRefsValidator } from "@back-end/src/validators/openapi";
import { PostCodeRefsResponse } from "@back-end/types/openapi";
import {
  getFeatureCodeRefsByFeatures,
  upsertFeatureCodeRefs,
} from "@back-end/src/models/FeatureCodeRefs";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const postCodeRefs = createApiRequestHandler(postCodeRefsValidator)(
  async (req): Promise<PostCodeRefsResponse> => {
    const { branch, repoName: repo } = req.body;
    const refsByFeature = groupBy(req.body.refs, "flagKey");

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

    return {
      featuresUpdated: (
        await getFeatureCodeRefsByFeatures({
          repo,
          branch,
          features: Object.keys(refsByFeature),
          organization: req.context.org,
        })
      ).map((f) => f.feature),
    };
  }
);
