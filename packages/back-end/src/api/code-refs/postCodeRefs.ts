import { groupBy, values } from "lodash";
import { PostCodeRefsResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postCodeRefsValidator } from "../../validators/openapi";
import {
  getAllFeatureCodeRefs,
  upsertFeatureCodeRefs,
} from "../../models/FeatureCodeRefs";

export const postCodeRefs = createApiRequestHandler(postCodeRefsValidator)(
  async (req): Promise<PostCodeRefsResponse> => {
    // eslint-disable-next-line no-console

    const { repo, branch, platform } = req.query;

    const refsByFeature = groupBy(req.body, "flagKey");

    await Promise.all(
      values(refsByFeature).map(async (refs) => {
        await upsertFeatureCodeRefs({
          feature: refs[0].flagKey,
          repo,
          branch,
          platform,
          codeRefs: refs,
        });
      })
    );

    return {
      featuresUpdated: (
        await getAllFeatureCodeRefs({
          repo,
          branch,
          platform,
        })
      ).map((f) => f.feature),
    };
  }
);
