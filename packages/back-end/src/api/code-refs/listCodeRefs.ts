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
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";

export const listCodeRefs = createApiRequestHandler(listCodeRefsValidator)(
  async (req) => {
    const orgCodeRefs = await getAllCodeRefsForOrg({ context: req.context });

    // Code ref flag keys equal feature ids. getFeaturesByIds drops features the
    // caller can't read, so only refs for readable features survive the filter.
    const readableFeatures = new Set(
      (
        await getFeaturesByIds(
          req.context,
          orgCodeRefs.map((r) => r.feature),
        )
      ).map((f) => f.id),
    );
    const allCodeRefs = orgCodeRefs.filter((r) =>
      readableFeatures.has(r.feature),
    );

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
