import { listConfirmationsValidator } from "shared/validators";
import {
  createApiRequestHandler,
  getPaginationReturnFields,
  validatePagination,
} from "back-end/src/util/handler";
import {
  confirmationStatusQuery,
  toApiConfirmation,
} from "back-end/src/services/confirmations";

// Same visibility as getConfirmation: the requesting key, or any token of the same person.
export const listConfirmations = createApiRequestHandler(
  listConfirmationsValidator,
)(async (req) => {
  const pagination = validatePagination(req.query);
  const { docs, total } =
    await req.context.models.confirmations.findByRequester(
      req.context.apiKey || null,
      req.context.userId || null,
      confirmationStatusQuery(req.query.status ?? "pending"),
      pagination,
    );
  const confirmations = docs.map(toApiConfirmation);
  return {
    confirmations,
    ...getPaginationReturnFields(confirmations, total, pagination),
  };
});
