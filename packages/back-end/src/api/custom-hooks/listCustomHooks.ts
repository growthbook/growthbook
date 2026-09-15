import { listCustomHooksValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { assertCustomHooksAvailable } from "./validations";

export const listCustomHooks = createApiRequestHandler(
  listCustomHooksValidator,
)(async (req) => {
  assertCustomHooksAvailable(req.context);

  const customHooks = await req.context.models.customHooks.getAll();

  const { filtered, returnFields } = applyPagination(
    customHooks.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  return {
    customHooks: filtered.map((hook) =>
      req.context.models.customHooks.toApiInterface(hook),
    ),
    ...returnFields,
  };
});
