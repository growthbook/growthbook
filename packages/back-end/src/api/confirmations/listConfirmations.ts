import { listConfirmationsValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { toApiConfirmation } from "back-end/src/services/confirmations";

// Stored statuses that toApiConfirmation can report as each API status.
const STORED_STATUSES = {
  pending: ["pending"],
  running: ["running"],
  completed: ["completed", "running"],
  rejected: ["rejected"],
  expired: ["expired", "pending"],
} as const;

// Same visibility as getConfirmation: the requesting key, or any token of the same person.
export const listConfirmations = createApiRequestHandler(
  listConfirmationsValidator,
)(async (req) => {
  const status = req.query.status ?? "pending";
  const docs = await req.context.models.confirmations.findByRequester(
    req.context.apiKey || null,
    req.context.userId || null,
    [...STORED_STATUSES[status]],
    status === "pending",
  );
  const { filtered, returnFields } = applyPagination(
    docs.map(toApiConfirmation).filter((c) => c.status === status),
    req.query,
  );
  return { confirmations: filtered, ...returnFields };
});
