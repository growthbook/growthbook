import { listErrorTrackingIssuesValidator } from "shared/validators";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { requireErrorTrackingClickhouse } from "back-end/src/services/errorTrackingSourceMaps";
import {
  queryGroupedIssues,
  getIssueDocs,
  buildIssueSummary,
} from "back-end/src/services/errorTrackingIssues";

export const listErrorTrackingIssues = createApiRequestHandler(
  listErrorTrackingIssuesValidator,
)(async (req) => {
  const { integration } = await requireErrorTrackingClickhouse(req.context);
  const { limit, offset } = validatePagination(req.query);
  const { clientKey, q } = req.query;

  const { rows, total } = await queryGroupedIssues({
    integration,
    clientKey,
    q,
    limit,
    offset,
  });

  const fingerprints = rows.map((r) => String(r.issue_fingerprint || ""));
  const meta = await getIssueDocs(req.context.org.id, clientKey, fingerprints);
  const issues = rows.map((r) =>
    buildIssueSummary(r, meta.get(String(r.issue_fingerprint || ""))),
  );

  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return {
    issues,
    limit,
    offset,
    count: issues.length,
    total,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
});
