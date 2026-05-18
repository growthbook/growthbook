import { postErrorTrackingSourceMapValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  requireErrorTrackingClickhouse,
  upsertErrorSourceMap,
} from "back-end/src/services/errorTrackingSourceMaps";

export const postErrorTrackingSourceMap = createApiRequestHandler(
  postErrorTrackingSourceMapValidator,
)(async (req) => {
  await requireErrorTrackingClickhouse(req.context);

  const { clientKey, release, minifiedUrl, sourceMapJson } = req.body;

  await upsertErrorSourceMap({
    organizationId: req.context.org.id,
    clientKey,
    release,
    minifiedUrl,
    sourceMapJson,
  });

  return { uploaded: true as const };
});
