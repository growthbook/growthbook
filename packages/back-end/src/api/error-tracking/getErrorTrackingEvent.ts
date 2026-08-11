import { getErrorTrackingEventValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { requireErrorTrackingClickhouse } from "back-end/src/services/errorTrackingSourceMaps";
import {
  queryEventDetailRow,
  buildEventDetail,
  queryRelatedFeatureUsage,
  queryRelatedExperimentViews,
} from "back-end/src/services/errorTrackingEvents";
import { buildSymbolicatedStack } from "back-end/src/services/errorTrackingSymbolication";

export const getErrorTrackingEvent = createApiRequestHandler(
  getErrorTrackingEventValidator,
)(async (req) => {
  const { integration } = await requireErrorTrackingClickhouse(req.context);
  const { clientKey, fingerprint, eventSearch } = req.query;
  const { eventUuid } = req.params;

  const row = await queryEventDetailRow({
    integration,
    clientKey,
    eventUuid,
    fingerprint,
    eventSearch,
  });
  if (!row) {
    throw new NotFoundError("Event not found");
  }

  const { detail, properties, userId, release } = buildEventDetail(row);

  const [relatedFeatureUsage, relatedExperimentViews] = userId
    ? await Promise.all([
        queryRelatedFeatureUsage({ integration, userId }),
        queryRelatedExperimentViews({ integration, userId }),
      ])
    : [[], []];

  const symbolicatedStack = await buildSymbolicatedStack({
    organizationId: req.context.org.id,
    clientKey,
    release,
    properties,
  });

  return {
    event: {
      ...detail,
      relatedFeatureUsage,
      relatedExperimentViews,
      urlAtCapture: detail.url,
      symbolicatedStack,
    },
  };
});
