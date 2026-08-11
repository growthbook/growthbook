import { listErrorTrackingIssueEventsValidator } from "shared/validators";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { requireErrorTrackingClickhouse } from "back-end/src/services/errorTrackingSourceMaps";
import {
  queryIssueEvents,
  buildEventSummary,
} from "back-end/src/services/errorTrackingEvents";

export const listErrorTrackingIssueEvents = createApiRequestHandler(
  listErrorTrackingIssueEventsValidator,
)(async (req) => {
  const { integration } = await requireErrorTrackingClickhouse(req.context);
  const { limit, offset } = validatePagination(req.query);
  const { clientKey, q, fromMs, toMs, order } = req.query;
  const { fingerprint } = req.params;

  const { rows, total } = await queryIssueEvents({
    integration,
    clientKey,
    fingerprint,
    q,
    limit,
    offset,
    fromMs,
    toMs,
    order,
  });

  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return {
    events: rows.map(buildEventSummary),
    limit,
    offset,
    count: rows.length,
    total,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
});
