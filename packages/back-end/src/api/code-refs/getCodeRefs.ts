import { GetCodeRefsResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getCodeRefsValidator } from "back-end/src/validators/openapi";
import {
  getAllCodeRefsForFeature,
  toApiInterface,
} from "back-end/src/models/FeatureCodeRefs";

export const getCodeRefs = createApiRequestHandler(getCodeRefsValidator)(
  async (req): Promise<GetCodeRefsResponse> => {
    const codeRefs = (
      await getAllCodeRefsForFeature({
        organization: req.context.org,
        feature: req.params.id,
      })
    ).map(toApiInterface);
    return {
      codeRefs,
    };
  }
);
