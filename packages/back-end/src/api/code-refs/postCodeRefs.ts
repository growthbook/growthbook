import { groupBy, values } from "lodash";
import { PostCodeRefsResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postCodeRefsValidator } from "../../validators/openapi";
import {
  getFeatureCodeRefsByFeatures,
  upsertFeatureCodeRefs,
} from "../../models/FeatureCodeRefs";

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
      }),
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
  },
);
