import { getCodeRefsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getAllCodeRefsForFeature,
  toApiInterface,
} from "back-end/src/models/FeatureCodeRefs";

export const getCodeRefs = createApiRequestHandler(getCodeRefsValidator)(async (
  req,
) => {
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
