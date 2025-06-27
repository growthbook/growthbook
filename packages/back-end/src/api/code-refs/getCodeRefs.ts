import { GetCodeRefsResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getCodeRefsValidator } from "back-end/src/validators/openapi";
import { getCodeRefsForFeature as getCodeRefsFromDb } from "back-end/src/models/FeatureCodeRefs";

export const getCodeRefs = createApiRequestHandler(getCodeRefsValidator)(
  async (req): Promise<GetCodeRefsResponse> => {
    return await getCodeRefsFromDb({
      context: req.context,
      feature: req.params.id,
    });
  }
);
