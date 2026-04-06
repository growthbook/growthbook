import omit from "lodash/omit";
import { z } from "zod";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getLatestActiveDraftForFeature } from "back-end/src/models/FeatureRevisionModel";

export const getFeatureRevisionLatest = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string() }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getLatestActiveDraftForFeature(
    req.context,
    req.organization.id,
    feature.id,
  );
  if (!revision) {
    throw new NotFoundError("No active draft revision found for this feature");
  }

  return { revision: omit(revision, "organization") };
});
