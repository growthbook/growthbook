import { listConfirmationsValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import {
  confirmationStatusQuery,
  toApiConfirmation,
} from "back-end/src/services/confirmations";

// Same visibility as getConfirmation: the requesting key, or any token of the same person.
export const listConfirmations = createApiRequestHandler(
  listConfirmationsValidator,
)(async (req) => {
  const status = req.query.status ?? "pending";
  const docs = await req.context.models.confirmations.findByRequester(
    req.context.apiKey || null,
    req.context.userId || null,
    confirmationStatusQuery(status),
  );
  // Drops a row whose status changed between the query and now, e.g. one that just expired.
  const { filtered, returnFields } = applyPagination(
    docs.map(toApiConfirmation).filter((c) => c.status === status),
    req.query,
  );
  return { confirmations: filtered, ...returnFields };
});
