import omit from "lodash/omit";
import { z } from "zod";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

export const getFeatureRevision = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  return { revision: omit(revision, "organization") };
});
