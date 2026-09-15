import { getCodeRefsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import {
  getAllCodeRefsForFeature,
  toApiInterface,
} from "back-end/src/models/FeatureCodeRefs";
import { getFeature } from "back-end/src/models/FeatureModel";

export const getCodeRefs = createApiRequestHandler(getCodeRefsValidator)(async (
  req,
) => {
  // Code ref flag keys equal feature ids. getFeature returns null when the
  // feature doesn't exist or the caller can't read its project. Return the same
  // 404 in both cases so we don't leak the existence of inaccessible features.
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) {
    throw new NotFoundError("Feature not found");
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
