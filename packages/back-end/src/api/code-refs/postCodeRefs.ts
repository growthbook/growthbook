import { PostCodeRefsResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postCodeRefsValidator } from "../../validators/openapi";

export const postCodeRefs = createApiRequestHandler(postCodeRefsValidator)(
  async (req): Promise<PostCodeRefsResponse> => {
    // eslint-disable-next-line no-console
    console.log("req", req);
    return {
      featuresUpdated: [],
    };
  }
);
