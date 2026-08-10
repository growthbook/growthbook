import { getErrorTrackingIssueValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { requireErrorTrackingClickhouse } from "back-end/src/services/errorTrackingSourceMaps";
import {
  queryIssueDetailRow,
  queryIssueDimensions,
  buildIssueDetailSummary,
  getIssueDocs,
} from "back-end/src/services/errorTrackingIssues";

export const getErrorTrackingIssue = createApiRequestHandler(
  getErrorTrackingIssueValidator,
)(async (req) => {
  const { integration } = await requireErrorTrackingClickhouse(req.context);
  const { clientKey } = req.query;
  const { fingerprint } = req.params;

  const row = await queryIssueDetailRow({
    integration,
    clientKey,
    fingerprint,
  });
  if (!row) {
    throw new NotFoundError("Issue not found");
  }

  const metaMap = await getIssueDocs(req.context.org.id, clientKey, [
    fingerprint,
  ]);
  const doc = metaMap.get(fingerprint);
  const dimensions = await queryIssueDimensions({
    integration,
    clientKey,
    fingerprint,
  });

  return {
    issue: {
      ...buildIssueDetailSummary(fingerprint, row, doc),
      comments: (doc?.comments || []).map((c) => ({
        userId: c.userId,
        userName: c.userName,
        body: c.body,
        date: c.date.toISOString(),
      })),
    },
    dimensions,
  };
});
