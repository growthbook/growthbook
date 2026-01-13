import { ListCodeRefsResponse } from "shared/types/openapi";
import { listCodeRefsValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import {
  getAllCodeRefsForOrg,
  toApiInterface,
  uniqueId,
} from "back-end/src/models/FeatureCodeRefs";

export const listCodeRefs = createApiRequestHandler(listCodeRefsValidator)(
  async (req): Promise<ListCodeRefsResponse> => {
    const allCodeRefs = await getAllCodeRefsForOrg({
      context: req.context,
    });

    const { filtered, returnFields } = applyPagination(
      allCodeRefs.sort((a, b) => uniqueId(a).localeCompare(uniqueId(b))),
      req.query,
    );

    return {
      codeRefs: filtered.map(toApiInterface),
      ...returnFields,
    };
  },
);
