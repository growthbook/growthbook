import { getCodeRefsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getAllCodeRefsForFeature,
  toApiInterface,
} from "back-end/src/models/FeatureCodeRefs";
import { getFeature } from "back-end/src/models/FeatureModel";

export const getCodeRefs = createApiRequestHandler(getCodeRefsValidator)(async (
  req,
) => {
  // Code ref flag keys equal feature ids. getFeature returns null when the
  // feature doesn't exist or the caller can't read its project.
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) {
    return { codeRefs: [] };
  }

  const codeRefs = (
    await getAllCodeRefsForFeature({
      organization: req.context.org,
      feature: req.params.id,
    })
  ).map(toApiInterface);
  return {
    codeRefs,
  };
});
