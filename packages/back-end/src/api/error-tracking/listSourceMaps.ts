import { listErrorTrackingSourceMapsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  listErrorSourceMaps,
  requireErrorTrackingClickhouse,
} from "back-end/src/services/errorTrackingSourceMaps";

export const listErrorTrackingSourceMaps = createApiRequestHandler(
  listErrorTrackingSourceMapsValidator,
)(async (req) => {
  await requireErrorTrackingClickhouse(req.context);

  const maps = await listErrorSourceMaps({
    organizationId: req.context.org.id,
    clientKey: req.query.clientKey,
    release: req.query.release,
  });

  return {
    maps: maps.map((map) => ({
      minifiedUrl: map.minifiedUrl,
      release: map.release,
      dateUpdated: map.dateUpdated?.toISOString(),
    })),
  };
});
